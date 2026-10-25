import type { PoolClient } from "pg";
import { getSetting } from "../settings/settingsRepo.js";
import { pool } from "../db/pool.js";

export class PaymentFlowError extends Error {}

export interface OrderForPayment {
  id: string;
  orderNumber: string;
  userId: string | null;
  guestEmail: string | null;
  status: string;
  total: string;
  currency: string;
}

export async function getOrderForPayment(orderId: string): Promise<OrderForPayment | null> {
  const result = await pool.query<{
    id: string;
    order_number: string;
    user_id: string | null;
    guest_email: string | null;
    status: string;
    total: string;
    currency: string;
  }>(`SELECT id, order_number, user_id, guest_email, status, total, currency FROM orders WHERE id = $1`, [orderId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    userId: row.user_id,
    guestEmail: row.guest_email,
    status: row.status,
    total: row.total,
    currency: row.currency,
  };
}

export async function getCustomerEmail(order: OrderForPayment): Promise<string> {
  if (order.guestEmail) return order.guestEmail;
  if (order.userId) {
    const result = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [order.userId]);
    if (result.rows[0]) return result.rows[0].email;
  }
  throw new PaymentFlowError("Order has no associated email to charge.");
}

export async function recordPaymentInitiated(params: {
  orderId: string;
  provider: "stripe" | "paystack" | "flutterwave" | "test";
  reference: string;
  amount: number;
  currency: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO payments (order_id, provider, provider_reference, status, amount, currency)
     VALUES ($1, $5::payment_provider, $2, 'initiated', $3, $4)`,
    [params.orderId, params.reference, params.amount, params.currency, params.provider],
  );
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  status: string;
}

export async function findPaymentByReference(reference: string): Promise<PaymentRecord | null> {
  const result = await pool.query<{ id: string; order_id: string; status: string }>(
    `SELECT id, order_id, status FROM payments WHERE provider_reference = $1`,
    [reference],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, orderId: row.order_id, status: row.status };
}

export async function markPaymentFailed(paymentId: string, rawPayload: unknown): Promise<void> {
  await pool.query(`UPDATE payments SET status = 'failed', raw_payload = $2 WHERE id = $1`, [
    paymentId,
    rawPayload,
  ]);
}

/**
 * The one place a payment becomes PAID. Runs the payment-row update, the
 * order-status update, and every inventory decrement in one transaction —
 * a webhook that dies partway through must never leave an order PAID with
 * stock not decremented, or vice versa. Each item's stock decrement is
 * still attempted individually and a failure there (e.g. a race that took
 * stock negative) is logged rather than rolled back: the customer's
 * payment already succeeded, so a stock-ledger conflict becomes an
 * operational problem for admin to see, never a reason to un-confirm a
 * real payment.
 */
export async function confirmPayment(params: {
  paymentId: string;
  orderId: string;
  rawPayload: unknown;
  onStockIssue: (message: string) => void;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`UPDATE payments SET status = 'success', verified_at = now(), raw_payload = $2 WHERE id = $1`, [
      params.paymentId,
      params.rawPayload,
    ]);
    await client.query(`UPDATE orders SET status = 'PAID' WHERE id = $1`, [params.orderId]);

    const items = await client.query<{ product_id: string | null; product_variant_id: string | null; quantity: number }>(
      `SELECT product_id, product_variant_id, quantity FROM order_items WHERE order_id = $1`,
      [params.orderId],
    );

    for (const item of items.rows) {
      const table = item.product_variant_id ? "product_variants" : "products";
      const id = item.product_variant_id ?? item.product_id;
      if (!id) continue;

      try {
        const current = await client.query<{ stock: number | null }>(`SELECT stock FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
        const stock = current.rows[0]?.stock;
        if (stock === null || stock === undefined) continue; // product/variant removed since order was placed

        const quantityAfter = stock - item.quantity;
        if (quantityAfter < 0) {
          params.onStockIssue(
            `Order ${params.orderId}: ${table} ${id} would go negative (${stock} - ${item.quantity}). Stock not decremented — needs manual review.`,
          );
          continue;
        }

        await client.query(`UPDATE ${table} SET stock = $2 WHERE id = $1`, [id, quantityAfter]);
        await client.query(
          `INSERT INTO inventory (product_id, product_variant_id, change_type, quantity_delta, quantity_after, note)
           VALUES ($1, $2, 'sale', $3, $4, $5)`,
          [
            item.product_variant_id ? null : item.product_id,
            item.product_variant_id,
            -item.quantity,
            quantityAfter,
            `Order ${params.orderId}`,
          ],
        );
      } catch (err) {
        params.onStockIssue(`Order ${params.orderId}: failed to decrement stock for ${table} ${id}: ${err}`);
      }
    }

    await completePaidOrder(client, params.orderId);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Everything that happens once money is confirmed, in the same transaction:
 * dispatch stage (or held for review), reward points, code usage, Subscribe &
 * Save plans, and closing the basket that produced the order.
 */
async function completePaidOrder(client: PoolClient, orderId: string): Promise<void> {
  const o = await client.query<{
    order_number: string; user_id: string | null; guest_email: string | null; total: string; cart_id: string | null;
    points_used: number; points_earned: number; discount_code: string | null;
    source: Record<string, unknown> | null;
  }>(`SELECT order_number, user_id, guest_email, total, cart_id, points_used, points_earned, discount_code, source FROM orders WHERE id = $1`, [orderId]);
  const order = o.rows[0];
  if (!order) return;

  const dispatch = await getSetting("dispatch");
  const total = Number(order.total);
  const held = dispatch.holdOn && total > Number(dispatch.holdOver);
  const stage = held ? "held" : "paid";
  const note = held ? `Paid. Held for a check (over £${dispatch.holdOver}).` : "Paid. Ready to pick and pack.";
  await client.query(
    `UPDATE orders SET fulfilment_stage = $2,
       receipt_number = COALESCE(receipt_number, nextval('orders_receipt_number_seq')),
       fulfilment_events = fulfilment_events || jsonb_build_array(jsonb_build_object('stage', $2::text, 'at', now(), 'note', $3::text))
     WHERE id = $1`,
    [orderId, stage, note],
  );

  if (order.user_id) {
    if (order.points_used > 0) {
      const r = await client.query<{ points_balance: number }>(`SELECT points_balance FROM users WHERE id = $1 FOR UPDATE`, [order.user_id]);
      const take = Math.min(order.points_used, r.rows[0]?.points_balance ?? 0);
      if (take > 0) {
        await client.query(`UPDATE users SET points_balance = points_balance - $2 WHERE id = $1`, [order.user_id, take]);
        await client.query(`INSERT INTO points_ledger (user_id, delta, reason, order_id) VALUES ($1, $2, $3, $4)`,
          [order.user_id, -take, `Redeemed on ${order.order_number}`, orderId]);
      }
    }
    if (order.points_earned > 0) {
      await client.query(`UPDATE users SET points_balance = points_balance + $2 WHERE id = $1`, [order.user_id, order.points_earned]);
      await client.query(`INSERT INTO points_ledger (user_id, delta, reason, order_id) VALUES ($1, $2, $3, $4)`,
        [order.user_id, order.points_earned, `Earned on ${order.order_number}`, orderId]);
    }
  }

  if (order.discount_code) {
    await client.query(`UPDATE discount_codes SET uses = uses + 1 WHERE code = $1`, [order.discount_code]);
  }

  const subs = await client.query<{ product_id: string | null; product_name_snapshot: string; quantity: number; subscription_months: number; unit_price: string }>(
    `SELECT product_id, product_name_snapshot, quantity, subscription_months, unit_price FROM order_items WHERE order_id = $1 AND subscription_months IS NOT NULL`,
    [orderId],
  );
  if (subs.rows.length) {
    const email = order.guest_email ?? (await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [order.user_id])).rows[0]?.email;
    for (const s of subs.rows) {
      await client.query(
        `INSERT INTO subscriptions (user_id, email, product_id, product_name, quantity, interval_months, unit_price, status, next_charge_at, source_order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', now() + make_interval(months => $6), $8)`,
        [order.user_id, email ?? "", s.product_id, s.product_name_snapshot, s.quantity, s.subscription_months, s.unit_price, orderId],
      );
    }
  }

  if (order.cart_id) {
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [order.cart_id]);
    await client.query(`UPDATE carts SET status = 'converted' WHERE id = $1 AND status = 'active'`, [order.cart_id]);
  }

  await client.query(
    `INSERT INTO events (type, message, user_id, meta) VALUES ('order', $1, $2, $3)`,
    [`Order ${order.order_number} paid, £${total.toFixed(2)}${held ? " (held for check)" : ""}`, order.user_id, JSON.stringify({ orderId, orderNumber: order.order_number, total, held, source: order.source ?? null })],
  );
}
