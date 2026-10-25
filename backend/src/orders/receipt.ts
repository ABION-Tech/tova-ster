import { pool } from "../db/pool.js";
import { getSetting } from "../settings/settingsRepo.js";

/**
 * One receipt shape for every place a receipt shows: the thank-you page,
 * the customer's account, the admin order panel and the receipt email.
 * Every figure comes from the order as stored at checkout, never recalculated,
 * so a receipt never changes after the fact.
 */
export interface Receipt {
  receiptNumber: string;
  orderNumber: string;
  placedAt: string;
  paidAt: string | null;
  status: string;
  stage: string;
  carrier: string | null;
  trackingNumber: string | null;
  customer: { name: string; email: string };
  address: { name: string; line1: string; line2: string | null; city: string; postcode: string } | null;
  items: { name: string; quantity: number; fullUnitPrice: number; unitPrice: number; lineTotal: number; subscriptionMonths: number | null; bundleName: string | null }[];
  discounts: { type: string; label: string; amount: number }[];
  subtotal: number;
  discountTotal: number;
  delivery: number;
  total: number;
  vat: number;
  pointsEarned: number;
  pointsUsed: number;
  paymentMethod: string | null;
  business: { name: string; address: string; company: string; vatNo: string; vatRegistered: boolean; email: string; web: string; footer: string };
}

export function formatReceiptNumber(n: number | string): string {
  return `R-${String(n).padStart(6, "0")}`;
}

/** `where` picks the order; params are passed straight to pg. */
async function load(where: string, params: unknown[]): Promise<Receipt | null> {
  const r = await pool.query(
    `SELECT o.*, a.full_name, a.line1, a.line2, a.city, a.postal_code,
            u.email AS user_email, u.first_name, u.last_name,
            (SELECT verified_at FROM payments p WHERE p.order_id = o.id AND p.status = 'success' ORDER BY verified_at DESC LIMIT 1) AS paid_at
     FROM orders o
     LEFT JOIN addresses a ON a.id = o.shipping_address_id
     LEFT JOIN users u ON u.id = o.user_id
     WHERE ${where}
     LIMIT 1`,
    params,
  );
  const o = r.rows[0];
  if (!o) return null;
  const items = await pool.query(
    `SELECT product_name_snapshot, quantity, unit_price, full_unit_price, line_total, subscription_months, bundle_name
     FROM order_items WHERE order_id = $1 ORDER BY created_at, id`,
    [o.id],
  );
  const business = await getSetting("business");
  return {
    receiptNumber: o.receipt_number == null ? "" : formatReceiptNumber(o.receipt_number),
    orderNumber: o.order_number,
    placedAt: o.placed_at ?? o.created_at,
    paidAt: o.paid_at,
    status: o.status,
    stage: o.fulfilment_stage,
    carrier: o.carrier,
    trackingNumber: o.tracking_number,
    customer: { name: o.full_name ?? [o.first_name, o.last_name].filter(Boolean).join(" "), email: o.user_email ?? o.guest_email ?? "" },
    address: o.line1 ? { name: o.full_name, line1: o.line1, line2: o.line2, city: o.city, postcode: o.postal_code } : null,
    items: items.rows.map((i) => ({
      name: i.product_name_snapshot,
      quantity: i.quantity,
      fullUnitPrice: Number(i.full_unit_price ?? i.unit_price),
      unitPrice: Number(i.unit_price),
      lineTotal: Number(i.line_total),
      subscriptionMonths: i.subscription_months,
      bundleName: i.bundle_name,
    })),
    discounts: (o.discounts ?? []).map((d: { type: string; label: string; amount: number }) => ({ ...d, amount: Number(d.amount) })),
    subtotal: Number(o.subtotal),
    discountTotal: Number(o.discount_total),
    delivery: Number(o.delivery_fee),
    total: Number(o.total),
    vat: Number(o.vat_total ?? 0),
    pointsEarned: o.points_earned,
    pointsUsed: o.points_used,
    paymentMethod: o.payment_method,
    business: {
      name: business.name, address: business.address, company: business.company, vatNo: business.vatNo,
      vatRegistered: business.vatRegistered, email: business.email, web: business.web, footer: business.footer,
    },
  };
}

export const receiptForCustomer = (orderNumber: string, userId: string) =>
  load(`o.order_number = $1 AND o.user_id = $2`, [orderNumber, userId]);

/** The payment reference (Stripe Checkout Session id) is unguessable, so holding it is enough to see that one receipt. */
export const receiptForPaymentReference = (reference: string) =>
  load(`o.id = (SELECT order_id FROM payments WHERE provider_reference = $1 LIMIT 1)`, [reference]);

export const receiptForAdmin = (orderId: string) => load(`o.id = $1`, [orderId]);
