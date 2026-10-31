import { pool } from "../db/pool.js";
import { logAdmin, logEvent } from "../events/eventsRepo.js";
import { paymentService } from "../services/payment/index.js";
import { emailService } from "../services/email/index.js";

/**
 * Refund an order (whole or part) through the payment provider, then record it.
 *
 * Order of work: the provider is asked first (outside any database lock), with
 * an idempotency key built from what has already been refunded, so a retry
 * after a crash returns the same refund rather than paying out twice. Only once
 * the provider says yes is anything recorded here.
 *
 * Full refund: status REFUNDED (or CANCELLED when the order is being
 * cancelled), points earned on the order taken back and points spent on it
 * given back, items optionally put back in stock.
 * Part refund: status unchanged; points earned taken back in proportion.
 */

export class RefundError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const REFUNDABLE = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"];
const toMinor = (pounds: number) => Math.round(pounds * 100);

export async function refundOrder(p: {
  orderId: string;
  admin: { id: string; name: string };
  amount?: number;          // pounds; default = everything not yet refunded
  restock?: boolean;        // put the items back in stock (full refunds only)
  reason?: string;
  cancel?: boolean;         // part of cancelling the order: end status CANCELLED
}): Promise<{ amount: number; full: boolean; status: string; refundId: string }> {
  const o = (await pool.query<{
    id: string; order_number: string; status: string; total: string; refunded_amount: string; user_id: string | null;
    points_used: number; points_earned: number; guest_email: string | null; user_email: string | null; first_name: string | null;
  }>(
    `SELECT o.id, o.order_number, o.status, o.total, o.refunded_amount, o.user_id, o.points_used, o.points_earned, o.guest_email,
            u.email AS user_email, u.first_name
     FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`, [p.orderId])).rows[0];
  if (!o) throw new RefundError("Order not found.", 404);
  if (!REFUNDABLE.includes(o.status)) throw new RefundError(`A ${o.status.toLowerCase().replace("_", " ")} order can't be refunded.`);

  const total = Number(o.total);
  const already = Number(o.refunded_amount);
  const left = Math.round((total - already) * 100) / 100;
  if (left <= 0) throw new RefundError("This order has already been refunded in full.");
  const amount = p.amount === undefined ? left : Math.round(p.amount * 100) / 100;
  if (!(amount > 0)) throw new RefundError("Enter an amount above £0.");
  if (amount > left) throw new RefundError(`You can refund up to £${left.toFixed(2)} on this order.`);
  const full = toMinor(amount) === toMinor(left);
  if (p.cancel && !full) throw new RefundError("Cancelling refunds the whole order.");

  const pay = (await pool.query<{ provider: string; provider_reference: string }>(
    `SELECT provider::text, provider_reference FROM payments WHERE order_id = $1 AND status = 'success' ORDER BY verified_at DESC NULLS LAST LIMIT 1`, [o.id])).rows[0];
  if (!pay) throw new RefundError("No confirmed payment found for this order.");

  const result = await paymentService.refund({
    reference: pay.provider_reference,
    amountMinor: toMinor(amount),
    idempotencyKey: `refund-${o.id}-${toMinor(already)}-${toMinor(amount)}`,
    note: p.reason ? `${o.order_number}: ${p.reason}` : o.order_number,
  });
  if (result.status === "failed") throw new RefundError("The payment provider refused the refund. Check the provider's dashboard.", 502);

  const restock = Boolean(full && p.restock);
  const newStatus = full ? (p.cancel ? "CANCELLED" : "REFUNDED") : o.status;
  const client = await pool.connect();
  let pointsReversed = 0;
  try {
    await client.query("BEGIN");
    // Lock and re-check, in case two people pressed Refund at once.
    const again = await client.query<{ refunded_amount: string }>(`SELECT refunded_amount FROM orders WHERE id = $1 FOR UPDATE`, [o.id]);
    if (toMinor(Number(again.rows[0].refunded_amount)) !== toMinor(already)) {
      // Someone else's refund landed first; this one matched theirs (same key) or is extra. Record nothing twice.
      const dup = await client.query(`SELECT 1 FROM refunds WHERE provider_refund_id = $1`, [result.id]);
      if (dup.rowCount) { await client.query("ROLLBACK"); return { amount, full, status: newStatus, refundId: result.id }; }
    }
    await client.query(
      `UPDATE orders SET refunded_amount = refunded_amount + $2, refunded_at = now(),
              status = $3::order_status, fulfilment_stage = CASE WHEN $4 THEN 'cancelled' ELSE fulfilment_stage END
       WHERE id = $1`, [o.id, amount, newStatus, full]);

    if (o.user_id) {
      // Points earned on this order come back off (in proportion for a part refund), never below zero.
      const before = await client.query<{ n: number }>(`SELECT COALESCE(SUM(points_reversed), 0)::int AS n FROM refunds WHERE order_id = $1`, [o.id]);
      const earnedBack = full ? Math.max(0, o.points_earned - before.rows[0].n) : Math.floor((o.points_earned * amount) / total);
      if (earnedBack > 0) {
        const bal = await client.query<{ points_balance: number }>(`SELECT points_balance FROM users WHERE id = $1 FOR UPDATE`, [o.user_id]);
        const take = Math.min(earnedBack, bal.rows[0]?.points_balance ?? 0);
        if (take > 0) {
          await client.query(`UPDATE users SET points_balance = points_balance - $2 WHERE id = $1`, [o.user_id, take]);
          await client.query(`INSERT INTO points_ledger (user_id, delta, reason, order_id, created_by) VALUES ($1, $2, $3, $4, $5)`,
            [o.user_id, -take, `Refund on ${o.order_number}`, o.id, p.admin.id]);
          pointsReversed += take;
        }
      }
      // Points spent on the order are given back on a full refund.
      if (full && o.points_used > 0) {
        await client.query(`UPDATE users SET points_balance = points_balance + $2 WHERE id = $1`, [o.user_id, o.points_used]);
        await client.query(`INSERT INTO points_ledger (user_id, delta, reason, order_id, created_by) VALUES ($1, $2, $3, $4, $5)`,
          [o.user_id, o.points_used, `Points returned: ${o.order_number} refunded`, o.id, p.admin.id]);
      }
    }

    if (restock) {
      const items = await client.query<{ product_id: string | null; product_variant_id: string | null; quantity: number }>(
        `SELECT product_id, product_variant_id, quantity FROM order_items WHERE order_id = $1`, [o.id]);
      for (const it of items.rows) {
        const table = it.product_variant_id ? "product_variants" : "products";
        const id = it.product_variant_id ?? it.product_id;
        if (!id) continue;
        const r = await client.query<{ stock: number | null }>(`UPDATE ${table} SET stock = stock + $2 WHERE id = $1 AND stock IS NOT NULL RETURNING stock`, [id, it.quantity]);
        if (!r.rows[0]) continue;
        await client.query(
          `INSERT INTO inventory (product_id, product_variant_id, change_type, quantity_delta, quantity_after, note, created_by)
           VALUES ($1, $2, 'return', $3, $4, $5, $6)`,
          [it.product_variant_id ? null : it.product_id, it.product_variant_id, it.quantity, r.rows[0].stock, `Refund ${o.order_number}`, p.admin.id]);
        // A sold-out product that's now back in stock shows again.
        if (table === "products") await client.query(`UPDATE products SET status = 'active' WHERE id = $1 AND status = 'out_of_stock' AND stock > 0`, [id]);
      }
    }

    await client.query(
      `INSERT INTO refunds (order_id, amount, provider, provider_refund_id, status, reason, restocked, points_reversed, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [o.id, amount, pay.provider, result.id, result.status, p.reason?.slice(0, 300) || null, restock, pointsReversed, p.admin.id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    // The provider has already refunded: say so plainly, so nobody refunds again.
    throw new RefundError(`The money was refunded (${result.id}) but saving it here failed. Don't refund again; tell the developer. ${e instanceof Error ? e.message : ""}`, 500);
  } finally {
    client.release();
  }

  const what = full ? (p.cancel ? "cancelled and refunded" : "refunded in full") : `part refunded (£${amount.toFixed(2)} of £${total.toFixed(2)})`;
  await logAdmin(p.admin.id, `${p.admin.name} ${what} ${o.order_number}`, { orderId: o.id, amount, refundId: result.id, restock, reason: p.reason ?? null });
  await logEvent({ type: "payment", message: `Refunded ${o.order_number}: £${amount.toFixed(2)}${full ? "" : " (part)"}`, userId: o.user_id,
    meta: { orderId: o.id, orderNumber: o.order_number, amount, refund: true, full, refundId: result.id, pending: result.status === "pending" } });

  const to = o.user_email ?? o.guest_email;
  if (to) {
    emailService.send({ to, subject: `Refund for order ${o.order_number}`, template: "refund_issued", data: {
      firstName: o.first_name ?? "", orderNumber: o.order_number, amount, full, cancelled: Boolean(p.cancel),
    } }, o.user_id).catch(() => { /* recorded as a failed email */ });
  }
  return { amount, full, status: newStatus, refundId: result.id };
}
