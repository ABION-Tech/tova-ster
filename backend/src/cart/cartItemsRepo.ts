import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { priceBasket, round2, type PricingBundle, type PricingResult, type ZoneKey } from "../pricing/engine.js";
import { pricingContext } from "../pricing/context.js";
import { getSetting } from "../settings/settingsRepo.js";
import { deliveryZone, formatPostcode, UnsupportedDestinationError } from "../services/delivery/index.js";

export class CartItemError extends Error {}

const SENTINEL = "00000000-0000-0000-0000-000000000000";
const PAID_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"];

export interface CartItemLine {
  id: string;
  productId: string;
  variantId: string | null;
  slug: string;
  quantity: number;
  productName: string;
  packSize: string | null;
  variantAttributes: Record<string, string> | null;
  imageUrl: string | null;
  snapshotPrice: number;     // price shown when the item was added — display-only
  currentPrice: number;      // live full price of one unit
  chargedUnit: number;       // after Subscribe & Save or bundle saving
  lineTotal: number;
  currentStock: number | null;
  isPurchasable: boolean;
  priceChanged: boolean;
  quantityExceedsStock: boolean;
  subscriptionMonths: number | null;
  isSubscription: boolean;
  bundleId: string | null;
  bundleName: string | null;
}

export interface CartSummary {
  items: CartItemLine[];
  /** Full price before any saving. */
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  hasBlockingIssues: boolean;
  pricing: Omit<PricingResult, "lines">;
  /** Which order line each priced figure belongs to (for VAT and order items). */
  lineNet: Record<string, number>;
  code: string | null;
  codeError: string | null;
  redeemPoints: boolean;
  pointsBalance: number;
  signedIn: boolean;
  postcode: string | null;
  email: string | null;
}

interface CartRow { id: string; user_id: string | null; discount_code: string | null; redeem_points: boolean; postcode: string | null; email: string | null }

interface ItemRow {
  id: string; product_id: string; product_variant_id: string | null; quantity: number; unit_price_snapshot: string;
  subscription_months: number | null; bundle_id: string | null;
  name: string; slug: string; pack_size: string | null; status: string; base_price: string; discount_price: string | null;
  stock: number | null; vat_rate: string; image_url: string | null;
  v_price: string | null; v_discount: string | null; v_stock: number | null; v_status: string | null; v_attributes: Record<string, string> | null; v_image: string | null;
}

// ── Discount codes ───────────────────────────────────────────────────────

/** Checks a code against today's rules. `who` lets first-order-only codes be checked once we know the shopper. */
export async function resolveCode(
  raw: string,
  who: { userId?: string | null; email?: string | null } = {},
): Promise<{ code: string; pct: number } | { error: string }> {
  const code = raw.trim().toUpperCase();
  if (!code) return { error: "Enter a code." };
  const features = await getSetting("features");
  if (!features.codes.on) return { error: "Discount codes aren't available right now." };
  const r = await pool.query<{ pct: string; active: boolean; uses: number; max_uses: number | null; expires_at: Date | null; first_order_only: boolean }>(
    `SELECT pct, active, uses, max_uses, expires_at, first_order_only FROM discount_codes WHERE code = $1`, [code],
  );
  const row = r.rows[0];
  if (!row || !row.active) return { error: `${code} isn't a valid code.` };
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return { error: `${code} has expired.` };
  if (row.max_uses != null && row.uses >= row.max_uses) return { error: `${code} has been fully used.` };
  if (row.first_order_only && (who.userId || who.email)) {
    const prior = await pool.query(
      `SELECT 1 FROM orders o LEFT JOIN users u ON u.id = o.user_id
       WHERE o.status::text = ANY($3::text[])
         AND (($1::uuid IS NOT NULL AND o.user_id = $1) OR ($2::text IS NOT NULL AND lower(coalesce(o.guest_email, u.email)) = lower($2)))
       LIMIT 1`,
      [who.userId ?? null, who.email ?? null, PAID_STATUSES],
    );
    if (prior.rowCount) return { error: `${code} is for first orders only.` };
  }
  return { code, pct: Number(row.pct) };
}

// ── Reading the basket ───────────────────────────────────────────────────

async function loadItems(cartId: string): Promise<ItemRow[]> {
  const r = await pool.query<ItemRow>(
    `SELECT ci.id, ci.product_id, ci.product_variant_id, ci.quantity, ci.unit_price_snapshot, ci.subscription_months, ci.bundle_id,
            p.name, p.slug, p.pack_size, p.status, p.base_price, p.discount_price, p.stock, p.vat_rate,
            (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) AS image_url,
            v.price AS v_price, v.discount_price AS v_discount, v.stock AS v_stock, v.status AS v_status, v.attributes AS v_attributes, v.image_url AS v_image
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN product_variants v ON v.id = ci.product_variant_id
     WHERE ci.cart_id = $1
     ORDER BY ci.created_at, ci.id`,
    [cartId],
  );
  return r.rows;
}

function liveOf(row: ItemRow) {
  if (row.product_variant_id) {
    const price = row.v_price != null ? Number(row.v_discount ?? row.v_price) : Number(row.discount_price ?? row.base_price);
    const active = row.v_status === "active" && row.status === "active";
    return { price, stock: row.v_stock, active, image: row.v_image ?? row.image_url, attributes: row.v_attributes };
  }
  return { price: Number(row.discount_price ?? row.base_price), stock: row.stock, active: row.status === "active", image: row.image_url, attributes: null };
}

async function loadBundles(ids: string[]): Promise<Map<string, PricingBundle>> {
  if (ids.length === 0) return new Map();
  const r = await pool.query<{ id: string; name: string; discount_pct: string; active: boolean; kind: "standard" | "quiz" }>(
    `SELECT id, name, discount_pct, active, kind FROM bundles WHERE id = ANY($1::uuid[])`, [ids],
  );
  return new Map(r.rows.map((b) => [b.id, { id: b.id, name: b.name, pct: Number(b.discount_pct), active: b.active, kind: b.kind }]));
}

/**
 * Every line is priced from live product data and today's admin settings,
 * never from the stored snapshot. `opts.postcode` overrides the remembered one
 * (checkout passes the delivery postcode); `opts.email` lets first-order codes
 * be checked for guests.
 */
export async function getCartSummary(cartId: string, opts: { postcode?: string; email?: string } = {}): Promise<CartSummary> {
  const cartRes = await pool.query<CartRow>(`SELECT id, user_id, discount_code, redeem_points, postcode, email FROM carts WHERE id = $1`, [cartId]);
  const cart = cartRes.rows[0];
  if (!cart) throw new CartItemError("Basket not found.");

  const [rows, ctx] = await Promise.all([loadItems(cartId), pricingContext()]);
  const bundles = await loadBundles([...new Set(rows.map((r) => r.bundle_id).filter((b): b is string => !!b))]);

  // Stock is checked per product across all lines (a product can sit in a bundle and on its own).
  const wanted = new Map<string, number>();
  for (const r of rows) {
    const k = r.product_variant_id ?? r.product_id;
    wanted.set(k, (wanted.get(k) ?? 0) + r.quantity);
  }

  const items: CartItemLine[] = rows.map((r) => {
    const live = liveOf(r);
    const want = wanted.get(r.product_variant_id ?? r.product_id) ?? r.quantity;
    return {
      id: r.id,
      productId: r.product_id,
      variantId: r.product_variant_id,
      slug: r.slug,
      quantity: r.quantity,
      productName: r.name,
      packSize: r.pack_size,
      variantAttributes: live.attributes,
      imageUrl: live.image,
      snapshotPrice: Number(r.unit_price_snapshot),
      currentPrice: live.price,
      chargedUnit: live.price,
      lineTotal: round2(live.price * r.quantity),
      currentStock: live.stock,
      isPurchasable: live.active && (live.stock === null || live.stock > 0),
      priceChanged: Math.abs(live.price - Number(r.unit_price_snapshot)) > 0.001,
      quantityExceedsStock: live.stock !== null && want > live.stock,
      subscriptionMonths: r.subscription_months,
      isSubscription: false,
      bundleId: r.bundle_id,
      bundleName: null,
    };
  });

  let zone: ZoneKey | null = null;
  const postcode = opts.postcode ?? cart.postcode;
  if (postcode) {
    try { zone = deliveryZone(postcode); } catch (err) { if (!(err instanceof UnsupportedDestinationError)) throw err; }
  }

  let code: { code: string; pct: number } | null = null;
  let codeError: string | null = null;
  if (cart.discount_code) {
    const res = await resolveCode(cart.discount_code, { userId: cart.user_id, email: opts.email ?? cart.email });
    if ("error" in res) codeError = res.error; else code = res;
  }

  let pointsBalance = 0;
  if (cart.user_id) {
    const u = await pool.query<{ points_balance: number }>(`SELECT points_balance FROM users WHERE id = $1`, [cart.user_id]);
    pointsBalance = u.rows[0]?.points_balance ?? 0;
  }

  const sellable = items.filter((i) => i.isPurchasable);
  const vatById = new Map(rows.map((r) => [r.id, Number(r.vat_rate)]));
  const priced = priceBasket({
    lines: sellable.map((i) => ({
      id: i.id, productId: i.productId, name: i.productName, unitPrice: i.currentPrice, quantity: i.quantity,
      vatRate: vatById.get(i.id) ?? ctx.vat, subscriptionMonths: i.subscriptionMonths, bundleId: i.bundleId,
    })),
    bundles,
    features: ctx.features,
    deliveryRates: { mainland: ctx.rates.mainland, highlands: ctx.rates.highlands, ni: ctx.rates.ni },
    zone,
    code,
    points: { signedIn: !!cart.user_id, balance: pointsBalance, redeem: cart.redeem_points },
  });

  const lineNet: Record<string, number> = {};
  for (const pl of priced.lines) {
    const item = items.find((i) => i.id === pl.id)!;
    item.chargedUnit = pl.chargedUnit;
    item.lineTotal = pl.lineTotal;
    item.isSubscription = pl.isSubscription;
    item.bundleName = pl.bundleName;
    lineNet[pl.id] = pl.netTotal;
  }

  const { lines: _lines, ...pricing } = priced;
  return {
    items,
    subtotal: priced.full,
    discountTotal: priced.saved,
    deliveryFee: priced.delivery,
    total: priced.total,
    hasBlockingIssues: items.some((i) => !i.isPurchasable || i.quantityExceedsStock),
    pricing,
    lineNet,
    code: cart.discount_code,
    codeError,
    redeemPoints: cart.redeem_points,
    pointsBalance,
    signedIn: !!cart.user_id,
    postcode: cart.postcode,
    email: cart.email,
  };
}

// ── Changing the basket ──────────────────────────────────────────────────

async function touch(client: PoolClient | typeof pool, cartId: string) {
  await client.query(`UPDATE carts SET last_activity_at = now() WHERE id = $1`, [cartId]);
}

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Live price/stock for one product, failing with a shopper-friendly message. */
async function sellableProduct(c: PoolClient | typeof pool, productId: string, variantId: string | null = null) {
  const r = await c.query<{ name: string; status: string; base_price: string; discount_price: string | null; stock: number | null;
    v_price: string | null; v_discount: string | null; v_stock: number | null; v_status: string | null }>(
    `SELECT p.name, p.status, p.base_price, p.discount_price, p.stock,
            v.price AS v_price, v.discount_price AS v_discount, v.stock AS v_stock, v.status AS v_status
     FROM products p LEFT JOIN product_variants v ON v.id = $2 AND v.product_id = p.id
     WHERE p.id = $1`,
    [productId, variantId],
  );
  const row = r.rows[0];
  if (!row || (variantId && row.v_status == null)) throw new CartItemError("Product not found.");
  const live = liveOf({ ...row, product_variant_id: variantId, image_url: null, v_attributes: null, v_image: null } as unknown as ItemRow);
  if (!live.active) throw new CartItemError(`${row.name} is not available right now.`);
  return { name: row.name, price: live.price, stock: live.stock };
}

/** Total units of a product already in the basket, optionally ignoring some lines. */
async function unitsInCart(c: PoolClient, cartId: string, productId: string, variantId: string | null, exceptIds: string[] = []): Promise<number> {
  const r = await c.query<{ n: string }>(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM cart_items
     WHERE cart_id = $1 AND product_id = $2 AND COALESCE(product_variant_id, $3::uuid) = COALESCE($4::uuid, $3::uuid) AND NOT (id = ANY($5::uuid[]))`,
    [cartId, productId, SENTINEL, variantId, exceptIds],
  );
  return Number(r.rows[0].n);
}

function checkStock(name: string, stock: number | null, total: number) {
  if (stock !== null && total > stock) throw new CartItemError(stock <= 0 ? `${name} is out of stock.` : `Only ${stock} of ${name} left in stock.`);
}

async function validMonths(months: number | null | undefined): Promise<number | null> {
  if (months == null) return null;
  const f = await getSetting("features");
  if (!f.subscribe.on) throw new CartItemError("Subscribe & Save isn't available right now.");
  if (!f.subscribe.freqs.includes(months)) throw new CartItemError("Choose a delivery frequency from the list.");
  return months;
}

/** Adds a single product (one-time, or Subscribe & Save every N months). */
export async function addCartItem(
  cartId: string,
  input: { productId: string; variantId?: string; quantity: number; subscriptionMonths?: number | null },
): Promise<void> {
  if (input.quantity < 1) throw new CartItemError("Quantity must be at least 1.");
  const months = await validMonths(input.subscriptionMonths);
  await inTx(async (c) => {
    const p = await sellableProduct(c, input.productId, input.variantId ?? null);
    const already = await unitsInCart(c, cartId, input.productId, input.variantId ?? null);
    checkStock(p.name, p.stock, already + input.quantity);

    // One line per product per purchase type: adding again just adds to it.
    const existing = await c.query<{ id: string }>(
      `SELECT id FROM cart_items
       WHERE cart_id = $1 AND product_id = $2 AND bundle_id IS NULL
         AND COALESCE(product_variant_id, $3::uuid) = COALESCE($4::uuid, $3::uuid)
         AND (subscription_months IS NULL) = ($5::int IS NULL)`,
      [cartId, input.productId, SENTINEL, input.variantId ?? null, months],
    );
    if (existing.rows[0]) {
      await c.query(
        `UPDATE cart_items SET quantity = quantity + $2, unit_price_snapshot = $3, subscription_months = $4 WHERE id = $1`,
        [existing.rows[0].id, input.quantity, p.price, months],
      );
    } else {
      await c.query(
        `INSERT INTO cart_items (cart_id, product_id, product_variant_id, quantity, unit_price_snapshot, subscription_months)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cartId, input.productId, input.variantId ?? null, input.quantity, p.price, months],
      );
    }
    await touch(c, cartId);
  });
}

/** Adds a bundle from the offers page. Each product in it becomes a line tied to the bundle. */
export async function addBundle(cartId: string, bundleId: string, quantity = 1): Promise<void> {
  const f = await getSetting("features");
  await inTx(async (c) => {
    const b = await c.query<{ name: string; product_ids: string[]; active: boolean; kind: string }>(
      `SELECT name, product_ids, active, kind FROM bundles WHERE id = $1`, [bundleId],
    );
    const bundle = b.rows[0];
    if (!bundle || !bundle.active || bundle.kind !== "standard" || !f.bundles.on) throw new CartItemError("This bundle isn't available right now.");
    await addBundleLines(c, cartId, bundleId, bundle.product_ids, quantity);
  });
}

/**
 * The quiz result as a set: creates a one-off quiz bundle (priced with the
 * quiz discount from settings) holding the recommended products.
 */
export async function addQuizSet(cartId: string, productIds: string[]): Promise<string> {
  const f = await getSetting("features");
  if (!f.quiz.on) throw new CartItemError("The vitamin finder isn't available right now.");
  const ids = [...new Set(productIds)];
  if (ids.length === 0) throw new CartItemError("Your set is empty.");
  if (ids.length > f.quiz.max) throw new CartItemError(`A set can hold up to ${f.quiz.max} products.`);
  return inTx(async (c) => {
    const b = await c.query<{ id: string }>(
      `INSERT INTO bundles (name, product_ids, discount_pct, active, kind) VALUES ('Your quiz set', $1::uuid[], 0, true, 'quiz') RETURNING id`,
      [ids],
    );
    await addBundleLines(c, cartId, b.rows[0].id, ids, 1);
    return b.rows[0].id;
  });
}

async function addBundleLines(c: PoolClient, cartId: string, bundleId: string, productIds: string[], quantity: number) {
  for (const pid of productIds) {
    const p = await sellableProduct(c, pid);
    const already = await unitsInCart(c, cartId, pid, null);
    checkStock(p.name, p.stock, already + quantity);
    await c.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, unit_price_snapshot, bundle_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cart_id, product_id, COALESCE(product_variant_id, '${SENTINEL}'::uuid), COALESCE(bundle_id, '${SENTINEL}'::uuid), COALESCE(subscription_months, 0))
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, unit_price_snapshot = EXCLUDED.unit_price_snapshot`,
      [cartId, pid, quantity, p.price, bundleId],
    );
  }
  await touch(c, cartId);
}

/** Bundle lines move together: changing one changes the whole bundle. */
export async function updateCartItemQuantity(cartId: string, itemId: string, quantity: number): Promise<void> {
  if (quantity < 1) throw new CartItemError("Quantity must be at least 1 — remove the item instead of setting it to 0.");
  await inTx(async (c) => {
    const item = await c.query<{ bundle_id: string | null }>(`SELECT bundle_id FROM cart_items WHERE id = $1 AND cart_id = $2`, [itemId, cartId]);
    if (!item.rows[0]) throw new CartItemError("Basket item not found.");
    const group = await c.query<{ id: string; product_id: string; product_variant_id: string | null }>(
      item.rows[0].bundle_id
        ? `SELECT id, product_id, product_variant_id FROM cart_items WHERE cart_id = $1 AND bundle_id = $2`
        : `SELECT id, product_id, product_variant_id FROM cart_items WHERE cart_id = $1 AND id = $2`,
      [cartId, item.rows[0].bundle_id ?? itemId],
    );
    const groupIds = group.rows.map((g) => g.id);
    for (const g of group.rows) {
      const p = await sellableProduct(c, g.product_id, g.product_variant_id);
      const others = await unitsInCart(c, cartId, g.product_id, g.product_variant_id, groupIds);
      checkStock(p.name, p.stock, others + quantity);
    }
    await c.query(`UPDATE cart_items SET quantity = $2 WHERE id = ANY($1::uuid[])`, [groupIds, quantity]);
    await touch(c, cartId);
  });
}

/** Switch a single line between one-time and Subscribe & Save (or change how often). */
export async function setItemSubscription(cartId: string, itemId: string, months: number | null): Promise<void> {
  const m = await validMonths(months);
  await inTx(async (c) => {
    const r = await c.query<{ product_id: string; product_variant_id: string | null; bundle_id: string | null; quantity: number }>(
      `SELECT product_id, product_variant_id, bundle_id, quantity FROM cart_items WHERE id = $1 AND cart_id = $2`, [itemId, cartId],
    );
    const item = r.rows[0];
    if (!item) throw new CartItemError("Basket item not found.");
    if (item.bundle_id) throw new CartItemError("Bundles can't be set to Subscribe & Save.");
    // If the other kind of line already exists for this product, merge into it.
    const twin = await c.query<{ id: string }>(
      `SELECT id FROM cart_items WHERE cart_id = $1 AND product_id = $2 AND bundle_id IS NULL AND id <> $3
         AND COALESCE(product_variant_id, $4::uuid) = COALESCE($5::uuid, $4::uuid)
         AND (subscription_months IS NULL) = ($6::int IS NULL)`,
      [cartId, item.product_id, itemId, SENTINEL, item.product_variant_id, m],
    );
    if (twin.rows[0]) {
      await c.query(`UPDATE cart_items SET quantity = quantity + $2, subscription_months = $3 WHERE id = $1`, [twin.rows[0].id, item.quantity, m]);
      await c.query(`DELETE FROM cart_items WHERE id = $1`, [itemId]);
    } else {
      await c.query(`UPDATE cart_items SET subscription_months = $2 WHERE id = $1`, [itemId, m]);
    }
    await touch(c, cartId);
  });
}

/** Removing any line of a bundle removes the whole bundle (its price only makes sense together). */
export async function removeCartItem(cartId: string, itemId: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM cart_items WHERE cart_id = $1 AND (id = $2 OR bundle_id = (SELECT bundle_id FROM cart_items WHERE id = $2 AND cart_id = $1 AND bundle_id IS NOT NULL))`,
    [cartId, itemId],
  );
  await touch(pool, cartId);
  return (r.rowCount ?? 0) > 0;
}

export async function clearCart(cartId: string): Promise<void> {
  await pool.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
  await pool.query(`UPDATE carts SET discount_code = NULL, redeem_points = FALSE, last_activity_at = now() WHERE id = $1`, [cartId]);
}

/** Saves a code on the basket after checking it. Returns the problem, if any. */
export async function setCartCode(cartId: string, raw: string | null): Promise<string | null> {
  if (!raw || !raw.trim()) {
    await pool.query(`UPDATE carts SET discount_code = NULL WHERE id = $1`, [cartId]);
    return null;
  }
  const cart = await pool.query<{ user_id: string | null; email: string | null }>(`SELECT user_id, email FROM carts WHERE id = $1`, [cartId]);
  const res = await resolveCode(raw, { userId: cart.rows[0]?.user_id, email: cart.rows[0]?.email });
  if ("error" in res) return res.error;
  await pool.query(`UPDATE carts SET discount_code = $2, last_activity_at = now() WHERE id = $1`, [cartId, res.code]);
  return null;
}

export async function setRedeemPoints(cartId: string, redeem: boolean): Promise<void> {
  await pool.query(`UPDATE carts SET redeem_points = $2 WHERE id = $1`, [cartId, redeem]);
}

/** Remembers the shopper's postcode (for the real delivery zone) and email (for basket reminders). */
export async function rememberOnCart(cartId: string, data: { postcode?: string | null; email?: string | null }): Promise<string | null> {
  if (data.postcode !== undefined) {
    if (data.postcode) {
      try { deliveryZone(data.postcode); } catch (err) {
        if (err instanceof UnsupportedDestinationError) return err.message;
        throw err;
      }
    }
    await pool.query(`UPDATE carts SET postcode = $2 WHERE id = $1`, [cartId, data.postcode ? formatPostcode(data.postcode) : null]);
  }
  if (data.email !== undefined) {
    const email = data.email?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
    await pool.query(`UPDATE carts SET email = $2 WHERE id = $1`, [cartId, email]);
  }
  return null;
}

