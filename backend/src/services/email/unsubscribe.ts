import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../../db/pool.js";
import { logEvent } from "../../events/eventsRepo.js";

/**
 * One-click unsubscribe for marketing emails (UK PECR; Gmail and Yahoo bulk
 * sender rules, RFC 8058).
 *
 * Each marketing email carries a signed link. The token is the address plus an
 * HMAC with SESSION_SECRET, so it can't be guessed or altered, and it needs no
 * database lookup or expiry: an unsubscribe link should keep working.
 */

/** Emails that are marketing (need an unsubscribe link). Order, account and team emails are not. */
export const MARKETING_TEMPLATES = new Set(["freebie", "birthday"]);

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set.");
  return s ?? "dev-only-unsubscribe-secret";
};

const sign = (email: string) => createHmac("sha256", secret()).update(`unsub:${email}`).digest("base64url").slice(0, 32);

export function unsubscribeToken(email: string): string {
  const e = email.trim().toLowerCase();
  return `${Buffer.from(e).toString("base64url")}.${sign(e)}`;
}

/** The address a token was made for, or null if it has been altered. */
export function readUnsubscribeToken(token: string): string | null {
  const [b64, mac] = String(token ?? "").split(".");
  if (!b64 || !mac) return null;
  let email: string;
  try { email = Buffer.from(b64, "base64url").toString("utf8"); } catch { return null; }
  if (!email.includes("@") || email.length > 200) return null;
  const want = Buffer.from(sign(email));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? email : null;
}

const trim = (u: string) => u.replace(/\/$/, "");

/** Page the shopper sees (asks them to confirm; link scanners can't unsubscribe anyone by opening it). */
export function unsubscribePageUrl(email: string): string {
  return `${trim(process.env.APP_URL ?? "https://tova-ster.com")}/unsubscribe?t=${unsubscribeToken(email)}`;
}

/** Address mail apps POST to for their own "Unsubscribe" button (RFC 8058). */
export function oneClickUrl(email: string): string {
  const api = process.env.API_URL ?? process.env.APP_URL ?? "https://tova-ster.com";
  return `${trim(api)}/unsubscribe/one-click?t=${unsubscribeToken(email)}`;
}

/** Stops marketing emails to this address: newsletter list, account setting and birthday email. */
export async function unsubscribe(email: string, how: "link" | "mail-app"): Promise<void> {
  const e = email.trim().toLowerCase();
  await pool.query(`UPDATE newsletter_subscribers SET unsubscribed_at = now() WHERE lower(email) = $1 AND unsubscribed_at IS NULL`, [e]);
  const u = await pool.query<{ id: string }>(
    `UPDATE users SET marketing_email = false, unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE lower(email) = $1 RETURNING id`, [e]);
  await logEvent({ type: "newsletter", message: how === "mail-app" ? "Unsubscribed (mail app button)" : "Unsubscribed (email link)", userId: u.rows[0]?.id ?? null, meta: { how } });
}
