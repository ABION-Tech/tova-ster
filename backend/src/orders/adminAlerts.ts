import { pool } from "../db/pool.js";
import { getSetting } from "../settings/settingsRepo.js";
import { emailService } from "../services/email/index.js";

/**
 * Team alerts after a paid order (never throw: an alert failure must not
 * affect the payment webhook). Sent to business.alertEmail.
 *  - New order: number, total, items, delivery postcode, held-for-check flag.
 *  - Low stock: any product or variant this order took down to (or below) its
 *    low-stock level, so each crossing is reported once, by the order that caused it.
 */
export async function sendOrderAlerts(orderId: string): Promise<void> {
  try {
    const [emails, business] = await Promise.all([getSetting("emails"), getSetting("business")]);
    const to = String(business.alertEmail || business.email || "").trim();
    if (!to) return;
    const o = await pool.query<{ order_number: string; total: string; fulfilment_stage: string; postal: string | null }>(
      `SELECT o.order_number, o.total, o.fulfilment_stage, a.postal_code AS postal
       FROM orders o LEFT JOIN addresses a ON a.id = o.shipping_address_id WHERE o.id = $1`, [orderId]);
    const order = o.rows[0];
    if (!order) return;
    const items = await pool.query<{ name: string; quantity: number; product_id: string; variant_id: string | null }>(
      `SELECT product_name_snapshot AS name, quantity, product_id, product_variant_id AS variant_id FROM order_items WHERE order_id = $1`, [orderId]);

    if (emails.adminNewOrder) {
      await emailService.send({
        to, subject: `New order ${order.order_number}: £${Number(order.total).toFixed(2)}${order.fulfilment_stage === "held" ? " (held for a check)" : ""}`,
        template: "admin_new_order",
        data: { orderNumber: order.order_number, total: Number(order.total), held: order.fulfilment_stage === "held", postcode: order.postal,
                items: items.rows.map((i) => ({ name: i.name, qty: i.quantity })) },
      }).catch(() => {});
    }

    if (emails.adminLowStock) {
      const low: { name: string; stock: number; threshold: number }[] = [];
      for (const i of items.rows) {
        const row = i.variant_id
          ? await pool.query<{ name: string; stock: number; threshold: number }>(
              `SELECT p.name || ' (' || v.sku || ')' AS name, v.stock, v.low_stock_threshold AS threshold FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [i.variant_id])
          : await pool.query<{ name: string; stock: number; threshold: number }>(
              `SELECT name, stock, low_stock_threshold AS threshold FROM products WHERE id = $1`, [i.product_id]);
        const s = row.rows[0];
        // Crossed on this order: was above the level before the sale, at or below it now.
        if (s && s.stock !== null && s.stock <= s.threshold && s.stock + i.quantity > s.threshold) low.push(s);
      }
      if (low.length) {
        await emailService.send({
          to, subject: `Low stock: ${low.map((l) => l.name).join(", ")}`,
          template: "admin_low_stock",
          data: { orderNumber: order.order_number, items: low },
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("order alerts failed", err);
  }
}
