import { pool } from "../db/pool.js";
import { logEvent } from "../events/eventsRepo.js";
import { sendOrderAlerts } from "../orders/adminAlerts.js";
import { emailService } from "../services/email/index.js";
import { getCustomerEmail, type OrderForPayment } from "./paymentRepo.js";

/**
 * After confirmPayment: the activity lines (payment, points), the team alerts
 * and the customer's order confirmation. Used by checkout webhooks and by
 * subscription renewals. Never throws: the money is already taken.
 */
export async function announcePaid(order: OrderForPayment, paymentId: string, log: { error: (o: unknown, m: string) => void }, opts: { renewal?: boolean } = {}): Promise<void> {
  try {
    const paid = await pool.query<{ payment_method: string | null }>(`SELECT provider::text AS payment_method FROM payments WHERE id = $1`, [paymentId]);
    await logEvent({ type: "payment", message: `Payment received for ${order.orderNumber}: £${Number(order.total).toFixed(2)}${opts.renewal ? " (Subscribe & Save renewal)" : ""}`, userId: order.userId,
      meta: { orderId: order.id, orderNumber: order.orderNumber, amount: Number(order.total), method: paid.rows[0]?.payment_method ?? null, renewal: Boolean(opts.renewal) } });
    // (The "order paid" line itself is written inside confirmPayment, in the same transaction.)
    const pts = await pool.query<{ delta: number; reason: string }>(`SELECT delta, reason FROM points_ledger WHERE order_id = $1`, [order.id]);
    for (const l of pts.rows) {
      await logEvent({ type: "points", message: l.delta > 0 ? `Earned ${l.delta} points on ${order.orderNumber}` : `Spent ${-l.delta} points on ${order.orderNumber}`, userId: order.userId, meta: { orderNumber: order.orderNumber, delta: l.delta, reason: l.reason } });
    }
    void sendOrderAlerts(order.id);
    const to = await getCustomerEmail(order);
    emailService.send({ to, subject: `Order confirmed — ${order.orderNumber}`, template: "order_confirmation", data: { orderNumber: order.orderNumber, total: Number(order.total), renewal: Boolean(opts.renewal) } }, order.userId)
      .catch((err) => log.error(err, "order_confirmation email failed"));
  } catch (err) {
    log.error(err, "after-payment steps failed");
  }
}
