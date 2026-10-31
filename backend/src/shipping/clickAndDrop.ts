import { pool } from "../db/pool.js";
import { getSetting } from "../settings/settingsRepo.js";
import { logEvent } from "../events/eventsRepo.js";
import { emailService } from "../services/email/index.js";

/**
 * Royal Mail Click & Drop, switched on by setting ROYALMAIL_API_KEY (from
 * Click & Drop › Settings › Integrations › Click & Drop API). Run every hour.
 *
 * 1. Paid orders (not held for a check) are sent to Click & Drop once, with
 *    the delivery address, items and weight. The team prints the day's labels
 *    there in one batch.
 * 2. When Click & Drop has printed a label, its tracking number comes back
 *    and the order shows as packed; when it's marked despatched there, the
 *    order is marked dispatched here and the customer gets the tracking email.
 *
 * Optional: ROYALMAIL_SERVICE_CODE (e.g. the account's Tracked 48 code) to
 * choose the service; without it Click & Drop's own shipping rules apply.
 * ROYALMAIL_DEFAULT_WEIGHT_G (default 250) per item when a product has no weight.
 */

const BASE = process.env.ROYALMAIL_API_BASE ?? "https://api.parcel.royalmail.com/api/v1";
export const clickAndDropOn = () => Boolean(process.env.ROYALMAIL_API_KEY);

async function rm<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.ROYALMAIL_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Click & Drop ${res.status}: ${(json && (json.message ?? json.title ?? JSON.stringify(json).slice(0, 200))) || res.statusText}`);
  return json as T;
}

type ToSend = {
  id: string; order_number: string; subtotal: string; delivery_fee: string; total: string; created_at: Date;
  email: string | null; full_name: string; phone: string | null; line1: string; line2: string | null; city: string; state: string | null; postal_code: string;
  items: { name: string; sku: string | null; qty: number; unit: number; grams: number | null }[];
};

/** Sends paid orders that haven't gone yet. Returns how many went. */
export async function sendPaidOrders(): Promise<number> {
  if (!clickAndDropOn()) return 0;
  const d = await getSetting("dispatch");
  if (!d.autoLabel) return 0;
  const r = await pool.query<ToSend>(
    `SELECT o.id, o.order_number, o.subtotal, o.delivery_fee, o.total, o.created_at, COALESCE(u.email, o.guest_email) AS email,
            a.full_name, COALESCE(a.phone, o.guest_phone, u.phone) AS phone, a.line1, a.line2, a.city, a.state, a.postal_code,
            (SELECT json_agg(json_build_object('name', oi.product_name_snapshot, 'sku', p.slug, 'qty', oi.quantity, 'unit', oi.unit_price, 'grams', p.weight_grams))
               FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items
     FROM orders o JOIN addresses a ON a.id = o.shipping_address_id LEFT JOIN users u ON u.id = o.user_id
     WHERE o.status IN ('PAID','PROCESSING') AND o.fulfilment_stage <> 'held' AND o.carrier_order_id IS NULL
       AND (o.carrier_error IS NULL OR o.carrier_sent_at < now() - interval '6 hours')
     ORDER BY o.created_at LIMIT 100`,
  );
  if (!r.rows.length) return 0;
  const perItem = Math.max(1, Number(process.env.ROYALMAIL_DEFAULT_WEIGHT_G) || 250);
  const service = process.env.ROYALMAIL_SERVICE_CODE;
  const items = r.rows.map((o) => ({
    orderReference: o.order_number,
    recipient: {
      address: { fullName: o.full_name, addressLine1: o.line1, addressLine2: o.line2 ?? undefined, city: o.city, county: o.state ?? undefined, postcode: o.postal_code, countryCode: "GB" },
      phoneNumber: o.phone ?? undefined, emailAddress: o.email ?? undefined,
    },
    packages: [{
      weightInGrams: o.items.reduce((g, i) => g + (i.grams ?? perItem) * i.qty, 0),
      packageFormatIdentifier: "parcel",
      contents: o.items.map((i) => ({ name: i.name, SKU: i.sku ?? undefined, quantity: i.qty, unitValue: Number(i.unit), unitWeightInGrams: i.grams ?? perItem })),
    }],
    orderDate: new Date(o.created_at).toISOString(),
    subtotal: Number(o.subtotal), shippingCostCharged: Number(o.delivery_fee), total: Number(o.total), currencyCode: "GBP",
    ...(service ? { postageDetails: { serviceCode: service, sendNotificationsTo: "recipient" } } : {}),
  }));
  const out = await rm<{ createdOrders?: { orderIdentifier: number | string; orderReference: string }[]; failedOrders?: { order?: { orderReference?: string }; errors?: { errorMessage?: string }[] }[] }>("POST", "/orders", { items });
  let sent = 0;
  for (const c of out.createdOrders ?? []) {
    const u = await pool.query<{ id: string; user_id: string | null }>(
      `UPDATE orders SET carrier_order_id = $2, carrier_sent_at = now(), carrier_error = NULL,
              fulfilment_stage = CASE WHEN fulfilment_stage = 'paid' THEN 'label' ELSE fulfilment_stage END
       WHERE order_number = $1 RETURNING id, user_id`, [c.orderReference, String(c.orderIdentifier)]);
    if (u.rows[0]) { sent++; await logEvent({ type: "dispatch", message: `${c.orderReference} sent to Royal Mail Click & Drop`, userId: u.rows[0].user_id, meta: { orderId: u.rows[0].id, carrierOrderId: String(c.orderIdentifier) } }); }
  }
  for (const f of out.failedOrders ?? []) {
    const ref = f.order?.orderReference;
    const why = (f.errors ?? []).map((e) => e.errorMessage).filter(Boolean).join("; ").slice(0, 300) || "Refused by Click & Drop";
    if (ref) {
      await pool.query(`UPDATE orders SET carrier_error = $2, carrier_sent_at = now() WHERE order_number = $1`, [ref, why]);
      await logEvent({ type: "dispatch", message: `${ref} couldn't be sent to Click & Drop: ${why}`, meta: { orderNumber: ref, problem: "click_and_drop" } });
    }
  }
  return sent;
}

/** Brings back tracking numbers and dispatch from Click & Drop. Returns how many orders changed. */
export async function syncFromClickAndDrop(): Promise<number> {
  if (!clickAndDropOn()) return 0;
  const open = await pool.query<{ id: string; order_number: string; carrier_order_id: string; tracking_number: string | null; user_id: string | null; email: string | null }>(
    `SELECT o.id, o.order_number, o.carrier_order_id, o.tracking_number, o.user_id, COALESCE(u.email, o.guest_email) AS email
     FROM orders o LEFT JOIN users u ON u.id = o.user_id
     WHERE o.carrier_order_id IS NOT NULL AND o.status IN ('PAID','PROCESSING') ORDER BY o.created_at LIMIT 100`);
  if (!open.rows.length) return 0;
  const ids = open.rows.map((o) => o.carrier_order_id).join(";");
  const info = await rm<{ orderIdentifier: number | string; trackingNumber?: string | null; printedOn?: string | null; shippedOn?: string | null }[]>("GET", `/orders/${encodeURIComponent(ids)}`);
  const emails = await getSetting("emails");
  let changed = 0;
  for (const i of info ?? []) {
    const o = open.rows.find((x) => x.carrier_order_id === String(i.orderIdentifier));
    if (!o) continue;
    const tracking = i.trackingNumber || o.tracking_number;
    if (i.shippedOn) {
      await pool.query(
        `UPDATE orders SET status = 'SHIPPED', fulfilment_stage = 'dispatched', dispatched_at = COALESCE(dispatched_at, now()), tracking_number = COALESCE($2, tracking_number), carrier = 'Royal Mail' WHERE id = $1`,
        [o.id, tracking]);
      await logEvent({ type: "dispatch", message: `${o.order_number} dispatched (Royal Mail ${tracking ?? ""})`.trim(), userId: o.user_id, meta: { orderId: o.id, orderNumber: o.order_number, stage: "dispatched", trackingNumber: tracking, carrier: "Royal Mail", via: "click_and_drop" } });
      if (o.email && emails.dispatched) {
        emailService.send({ to: o.email, subject: `Your order ${o.order_number} has shipped`, template: "order_shipped",
          data: { trackingCode: tracking, courierName: "Royal Mail", orderNumber: o.order_number, status: "SHIPPED", statusLabel: "Shipped" } }, o.user_id).catch(() => { /* recorded */ });
      }
      changed++;
    } else if (i.printedOn && tracking && tracking !== o.tracking_number) {
      await pool.query(`UPDATE orders SET status = 'PROCESSING', fulfilment_stage = 'packed', tracking_number = $2, carrier = 'Royal Mail' WHERE id = $1`, [o.id, tracking]);
      await logEvent({ type: "dispatch", message: `${o.order_number} label printed (Royal Mail ${tracking})`, userId: o.user_id, meta: { orderId: o.id, orderNumber: o.order_number, stage: "packed", trackingNumber: tracking, via: "click_and_drop" } });
      changed++;
    }
  }
  return changed;
}
