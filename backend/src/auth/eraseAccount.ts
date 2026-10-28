import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { hashPassword } from "./passwords.js";

/**
 * A customer deletes their own account (UK GDPR right to erasure).
 *
 * Erased at once: name, email, phone, birthday, password, saved basket and
 * browsing state, unused addresses, reviews, points, team notes, newsletter
 * sign-up, browsing records (visits, views, searches, quiz), sessions.
 *
 * Kept, without the person's name or email: paid orders and the addresses
 * they were sent to, payments and receipt numbers, because UK law requires
 * VAT and sales records to be kept for six years. The account row stays as
 * an anonymous placeholder so those records still add up.
 *
 * Refused while an order is paid but not yet delivered, so the parcel and any
 * refund can still be handled.
 */
export type EraseResult = { ok: true } | { ok: false; reason: "open_orders"; orders: string[] };

const OPEN = `('PAID','PROCESSING','SHIPPED')`;

export async function eraseAccount(userId: string): Promise<EraseResult> {
  const open = await pool.query<{ order_number: string }>(
    `SELECT order_number FROM orders WHERE user_id = $1 AND status IN ${OPEN} ORDER BY created_at`, [userId]);
  if (open.rowCount) return { ok: false, reason: "open_orders", orders: open.rows.map((r) => r.order_number) };

  const unusable = await hashPassword(randomBytes(32).toString("hex"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const u = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1 AND erased_at IS NULL FOR UPDATE`, [userId]);
    if (!u.rows[0]) { await client.query("ROLLBACK"); return { ok: true }; } // already gone
    const email = u.rows[0].email;

    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM carts WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM product_reviews WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM points_ledger WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM customer_notes WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM events WHERE user_id = $1 AND type IN ('visit','view','search','quiz','profile','basket','checkout')`, [userId]);
    await client.query(`DELETE FROM newsletter_subscribers WHERE lower(email) = lower($1)`, [email]);
    // Addresses used on an order are kept for the sales record (unlinked from the account); others are deleted.
    await client.query(
      `DELETE FROM addresses a WHERE a.user_id = $1
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shipping_address_id = a.id OR o.billing_address_id = a.id)`, [userId]);
    await client.query(`UPDATE addresses SET user_id = NULL, phone = NULL, label = NULL WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE subscriptions SET status = 'cancelled', email = 'erased', user_id = NULL WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE users SET
         email = $2, password_hash = $3, first_name = 'Deleted', last_name = 'account', phone = NULL, google_id = NULL,
         email_verified = false, email_verification_token = NULL, email_verification_expires_at = NULL,
         password_reset_token = NULL, password_reset_expires_at = NULL,
         marketing_email = false, marketing_sms = false, points_balance = 0, acquisition_source = NULL, tags = '{}',
         saved_state = '{}'::jsonb, birthday_day = NULL, birthday_month = NULL, birthday_treat_year = NULL, erased_at = now()
       WHERE id = $1`,
      [userId, `erased-${userId}@erased.invalid`, unusable],
    );
    await client.query(`UPDATE orders SET guest_email = NULL, guest_phone = NULL WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO events (type, message, user_id, meta) VALUES ('profile', 'Deleted their account (personal details erased; order records kept for VAT)', $1, '{"action":"account_erased"}')`,
      [userId],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
