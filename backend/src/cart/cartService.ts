import type { FastifyReply, FastifyRequest } from "fastify";
import { secureCookies } from "../auth/cookieMode.js";
import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import type { AuthUser } from "../auth/session.js";
import { hashToken } from "../auth/tokens.js";

export const GUEST_CART_COOKIE = "guest_cart_token";
const GUEST_CART_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — long enough to survive "left and returned later"

function guestCookieOptions() {
  const isProd = secureCookies;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: Math.floor(GUEST_CART_TTL_MS / 1000),
  };
}

interface CartRow {
  id: string;
  status: string;
  created_at: string;
}

/**
 * Cart identity for the current request — creates a cart (and, for guests,
 * the cookie that points at it) if one doesn't exist yet. Does NOT handle
 * cart *items*; that's the storefront/checkout stages' job. This only owns
 * "which single active cart does this visitor own right now", which is what
 * Stage 3's profile-linking requirement actually depends on.
 */
export async function getOrCreateCart(
  req: FastifyRequest,
  reply: FastifyReply,
  user: AuthUser | null,
): Promise<CartRow> {
  if (user) {
    const existing = await pool.query<CartRow>(
      `SELECT id, status, created_at FROM carts WHERE user_id = $1 AND status = 'active'`,
      [user.id],
    );
    if (existing.rows[0]) return existing.rows[0];

    const created = await pool.query<CartRow>(
      `INSERT INTO carts (user_id, status) VALUES ($1, 'active') RETURNING id, status, created_at`,
      [user.id],
    );
    return created.rows[0];
  }

  const guestToken = req.cookies[GUEST_CART_COOKIE];
  if (guestToken) {
    // The cookie carries the raw token; only its hash is ever stored or
    // queried against, matching how session tokens are handled — a stolen
    // database dump shouldn't hand someone every live guest cart.
    const existing = await pool.query<CartRow>(
      `SELECT id, status, created_at FROM carts WHERE guest_token = $1 AND status = 'active'`,
      [hashToken(guestToken)],
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  // No cookie, or the cookie no longer points at a live active cart —
  // start a fresh guest lineage.
  const newToken = randomBytes(24).toString("hex");
  const created = await pool.query<CartRow>(
    `INSERT INTO carts (guest_token, status) VALUES ($1, 'active') RETURNING id, status, created_at`,
    [hashToken(newToken)],
  );
  reply.setCookie(GUEST_CART_COOKIE, newToken, guestCookieOptions());
  return created.rows[0];
}

/**
 * Called from login/register once we know who the user is. Adopts the
 * guest cart as the account's active cart rather than copying cart_items
 * into a second row (see docs/schema.md) — so "one profile, one cart
 * lineage" stays a database guarantee (the partial unique index on
 * `carts(user_id) WHERE status='active'`) rather than an app-layer
 * convention. Trade-off: if the account already had its own active cart
 * with items, that cart is archived (status='converted'), not merged —
 * the guest cart, being the most recent activity, wins. See docs/schema.md
 * for the reasoning and the merge-on-conflict enhancement left for V2.
 */
export async function attachGuestCartToUser(
  guestToken: string | undefined,
  userId: string,
  reply: FastifyReply,
): Promise<void> {
  if (!guestToken) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const guestCart = await client.query<CartRow>(
      `SELECT id, status, created_at FROM carts WHERE guest_token = $1 AND status = 'active'`,
      [hashToken(guestToken)],
    );
    if (!guestCart.rows[0]) {
      await client.query("COMMIT");
      return; // nothing to attach
    }

    const existingUserCart = await client.query<CartRow>(
      `SELECT id, status, created_at FROM carts WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    const oldCartId = existingUserCart.rows[0]?.id;
    if (oldCartId) {
      // Merge: whatever the account saved on another device joins the guest
      // basket. The same line on both keeps the larger quantity (not the sum:
      // it is usually the same item added twice, not a wish for double).
      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, product_variant_id, quantity, unit_price_snapshot, bundle_id, subscription_months)
         SELECT $1, product_id, product_variant_id, quantity, unit_price_snapshot, bundle_id, subscription_months
         FROM cart_items WHERE cart_id = $2
         ON CONFLICT (cart_id, product_id,
           COALESCE(product_variant_id, '00000000-0000-0000-0000-000000000000'::UUID),
           COALESCE(bundle_id, '00000000-0000-0000-0000-000000000000'::UUID),
           COALESCE(subscription_months, 0))
         DO UPDATE SET quantity = LEAST(50, GREATEST(cart_items.quantity, EXCLUDED.quantity))`,
        [guestCart.rows[0].id, oldCartId],
      );
      // Keep remembered details the guest basket doesn't have yet.
      await client.query(
        `UPDATE carts g SET discount_code = COALESCE(g.discount_code, o.discount_code),
                            postcode = COALESCE(g.postcode, o.postcode),
                            email = COALESCE(g.email, o.email)
         FROM carts o WHERE g.id = $1 AND o.id = $2`,
        [guestCart.rows[0].id, oldCartId],
      );
      // Archive before adopting — never two 'active' rows for one user_id.
      await client.query(`UPDATE carts SET status = 'converted' WHERE id = $1`, [oldCartId]);
    }

    await client.query(
      `UPDATE carts SET user_id = $1, guest_token = NULL WHERE id = $2`,
      [userId, guestCart.rows[0].id],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // The guest cart now belongs to the account via the session cookie instead.
  reply.clearCookie(GUEST_CART_COOKIE, { path: "/" });
}
