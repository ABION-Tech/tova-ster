import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { getSetting } from "../settings/settingsRepo.js";
import { logEvent } from "../events/eventsRepo.js";
import { emailService } from "../services/email/index.js";
import { paymentService, paymentProvider } from "../services/payment/index.js";
import { deliveryZone } from "../services/delivery/index.js";
import { pricingContext } from "../pricing/context.js";
import { priceBasket, type PricingLine, type PricingResult } from "../pricing/engine.js";
import { confirmPayment, getOrderForPayment, markPaymentFailed, recordPaymentInitiated } from "../payments/paymentRepo.js";
import { announcePaid } from "../payments/afterPaid.js";

/**
 * Subscribe & Save renewals, run every hour.
 *
 * Subscriptions due for the same customer, address and card are charged
 * together as one order (one delivery fee, free over the threshold). Prices
 * are today's price less today's Subscribe & Save discount, worked out by the
 * same pricing engine as the shop, so the receipt matches the basket rules.
 *
 * The saved card is charged with the customer not present. Each attempt has
 * its own key (subscription, due date, attempt), so a repeat run never charges
 * twice. A declined card: the order is cancelled, the customer is emailed a
 * link to update their card, and it's tried again in 2 days; after 3 failures
 * the subscription is paused until they update it.
 */

const MAX_TRIES = 3;
const RETRY_DAYS = 2;
const appUrl = () => (process.env.APP_URL ?? "https://tova-ster.co.uk").replace(/\/$/, "");

type DueSub = {
  id: string; user_id: string | null; email: string; product_id: string | null; product_name: string; quantity: number;
  interval_months: number; status: string; next_charge_at: Date; failed_attempts: number;
  provider_customer_id: string | null; payment_method_id: string | null; shipping_address_id: string | null;
  p_name: string | null; p_status: string | null; p_stock: number | null; p_price: string | null; p_vat: string | null;
  postal_code: string | null; first_name: string | null;
};

/** Today's price for a set of subscription lines going to one postcode. */
export async function quoteSubscriptions(lines: { id: string; productId: string; name: string; price: number; vat: number; quantity: number; months: number }[], postcode: string | null): Promise<PricingResult> {
  const ctx = await pricingContext();
  let zone: ReturnType<typeof deliveryZone> | null = null;
  try { zone = postcode ? deliveryZone(postcode) : null; } catch { zone = null; }
  const pl: PricingLine[] = lines.map((l) => ({ id: l.id, productId: l.productId, name: l.name, unitPrice: l.price, quantity: l.quantity, vatRate: l.vat, subscriptionMonths: l.months, bundleId: null }));
  return priceBasket({
    lines: pl, bundles: new Map(), features: ctx.features,
    deliveryRates: { mainland: ctx.rates.mainland, highlands: ctx.rates.highlands, ni: ctx.rates.ni },
    zone, code: null, points: { signedIn: false, balance: 0, redeem: false },
  });
}

function nextDate(from: Date, months: number, now: Date): Date {
  const d = new Date(from);
  do { d.setUTCMonth(d.getUTCMonth() + months); } while (d <= now);
  return d;
}

async function emailOnce(kind: string, ref: string, to: string, subject: string, template: string, data: Record<string, unknown>, userId: string | null) {
  const claim = await pool.query(`INSERT INTO email_sends (kind, ref, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [kind, ref, to.toLowerCase()]);
  if (!claim.rowCount) return;
  emailService.send({ to, subject, template, data }, userId).catch(() => { /* recorded as a failed email */ });
}

export async function runRenewals(now = new Date(), log: { error: (o: unknown, m: string) => void } = console): Promise<{ charged: number; failed: number; deferred: number }> {
  const out = { charged: 0, failed: 0, deferred: 0 };
  const dispatch = await getSetting("dispatch");
  const features = await getSetting("features");
  if (!dispatch.subsAuto || !features.subscribe?.on || !paymentService.canRenew) return out;

  const due = await pool.query<DueSub>(
    `SELECT s.id, s.user_id, COALESCE(u.email, s.email) AS email, s.product_id, s.product_name, s.quantity, s.interval_months, s.status,
            s.next_charge_at, s.failed_attempts, s.provider_customer_id, s.payment_method_id, s.shipping_address_id,
            p.name AS p_name, p.status::text AS p_status, p.stock AS p_stock, p.base_price AS p_price, p.vat_rate AS p_vat,
            a.postal_code, u.first_name
     FROM subscriptions s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN products p ON p.id = s.product_id
     LEFT JOIN addresses a ON a.id = s.shipping_address_id
     WHERE s.next_charge_at <= $1 AND (u.id IS NULL OR u.erased_at IS NULL)
       AND (s.status = 'active' OR (s.status = 'past_due' AND s.failed_attempts BETWEEN 1 AND ${MAX_TRIES - 1}))
     ORDER BY s.next_charge_at
     LIMIT 200`,
    [now],
  );

  // Group: same customer, address and card → one order.
  const groups = new Map<string, DueSub[]>();
  for (const s of due.rows) {
    // Product gone for good: end the subscription and say so.
    if (!s.product_id || !s.p_status || s.p_status === "archived" || s.p_status === "draft") {
      await pool.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [s.id]);
      await logEvent({ type: "subscription", message: `Ended ${s.product_name} subscription: the product is no longer sold`, userId: s.user_id, meta: { subscriptionId: s.id } });
      continue;
    }
    // Not enough stock: try again in a week rather than charge for something we can't send.
    if (s.p_stock !== null && s.p_stock < s.quantity) {
      await pool.query(`UPDATE subscriptions SET next_charge_at = $2::timestamptz + interval '7 days' WHERE id = $1`, [s.id, now]);
      await logEvent({ type: "subscription", message: `Renewal of ${s.product_name} put back a week: not enough stock`, userId: s.user_id, meta: { subscriptionId: s.id } });
      out.deferred++;
      continue;
    }
    // No saved card or address (older plans, or a provider that didn't save one): ask the customer.
    if (!s.payment_method_id || !s.provider_customer_id || !s.shipping_address_id) {
      await pool.query(`UPDATE subscriptions SET status = 'past_due', failed_attempts = ${MAX_TRIES} WHERE id = $1`, [s.id]);
      await emailOnce("renewal_card", `${s.id}:${new Date(s.next_charge_at).toISOString().slice(0, 10)}`, s.email, "Please add a card for your subscription", "renewal_failed",
        { firstName: s.first_name ?? "", products: [s.product_name], reason: "We don't have a card saved for this subscription.", link: `${appUrl()}/account?tab=subscriptions`, final: true }, s.user_id);
      out.failed++;
      continue;
    }
    const key = `${s.user_id ?? s.email}|${s.shipping_address_id}|${s.payment_method_id}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  for (const subs of groups.values()) {
    try {
      const r = await renewGroup(subs, now, log);
      out[r]++;
    } catch (err) {
      log.error(err, "subscription renewal failed");
    }
  }
  return out;
}

async function renewGroup(subs: DueSub[], now: Date, log: { error: (o: unknown, m: string) => void }): Promise<"charged" | "failed" | "deferred"> {
  const first = subs[0]!;
  const attempt = Math.max(...subs.map((s) => s.failed_attempts));
  // The due time (to the second) changes every cycle, retry and card update, so each charge attempt has its own key.
  const dueAt = new Date(Math.min(...subs.map((s) => new Date(s.next_charge_at).getTime()))).toISOString();
  const renewalKey = `renew:${subs.map((s) => s.id).sort().join("+")}:${dueAt}:${attempt}`;

  const price = await quoteSubscriptions(subs.map((s) => ({
    id: s.id, productId: s.product_id!, name: s.p_name!, price: Number(s.p_price), vat: Number(s.p_vat ?? 20), quantity: s.quantity, months: s.interval_months,
  })), first.postal_code);
  const pointsEarned = first.user_id ? price.pointsEarned : 0;
  const orderNumber = `TS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

  // 1. The order, once per key.
  const client = await pool.connect();
  let orderId: string;
  try {
    await client.query("BEGIN");
    const o = await client.query<{ id: string }>(
      `INSERT INTO orders (order_number, user_id, guest_email, status, currency, subtotal, delivery_fee, discount_total, total, shipping_address_id,
                           vat_total, discounts, points_used, points_earned, has_subscription, renewal_key, source)
       VALUES ($1, $2, $3, 'PENDING_PAYMENT', 'GBP', $4, $5, $6, $7, $8, $9, $10, 0, $11, true, $12, $13)
       ON CONFLICT (renewal_key) WHERE renewal_key IS NOT NULL DO NOTHING RETURNING id`,
      [orderNumber, first.user_id, first.user_id ? null : first.email, price.full, price.delivery, price.saved, price.total, first.shipping_address_id,
        price.vat, JSON.stringify(price.discounts), pointsEarned, renewalKey, JSON.stringify({ utm_source: "subscription" })],
    );
    if (!o.rows[0]) { await client.query("ROLLBACK"); return "deferred"; } // another run has it
    orderId = o.rows[0].id;
    for (const l of price.lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, unit_price, quantity, line_total, full_unit_price, subscription_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [orderId, l.productId, l.name, l.chargedUnit, l.quantity, l.lineTotal, l.fullUnit, l.subscriptionMonths]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // 2. Charge the saved card (outside any transaction; the key stops double charges).
  const charge = await paymentService.chargeSaved({
    customerId: first.provider_customer_id!, paymentMethodId: first.payment_method_id!, amountMinor: Math.round(price.total * 100), currency: "GBP",
    idempotencyKey: renewalKey, description: `Tova-Ster order ${orderNumber} (Subscribe & Save)`, metadata: { orderNumber, orderId },
  });
  await recordPaymentInitiated({ orderId, provider: paymentProvider, reference: charge.reference, amount: price.total, currency: "GBP" });
  const payment = (await pool.query<{ id: string }>(`SELECT id FROM payments WHERE provider_reference = $1`, [charge.reference])).rows[0]!;
  const ids = subs.map((s) => s.id);
  const names = subs.map((s) => s.p_name ?? s.product_name);

  if (charge.status === "success" || charge.status === "pending") {
    if (charge.status === "success") {
      await confirmPayment({ paymentId: payment.id, orderId, rawPayload: charge.raw ?? null, onStockIssue: (m) => log.error(new Error(m), "renewal stock") });
    } else {
      await logEvent({ type: "payment", message: `Renewal ${orderNumber} is still processing at the bank: check it in Stripe`, userId: first.user_id, meta: { orderId, orderNumber, pending: true } });
    }
    for (const s of subs) {
      await pool.query(
        `UPDATE subscriptions SET status = 'active', failed_attempts = 0, last_failed_at = NULL, last_renewed_at = now(), next_charge_at = $2 WHERE id = $1`,
        [s.id, nextDate(new Date(s.next_charge_at), s.interval_months, now)]);
    }
    await logEvent({ type: "subscription", message: `Renewed ${names.join(", ")}: ${orderNumber}, £${price.total.toFixed(2)}`, userId: first.user_id, meta: { orderId, orderNumber, subscriptionIds: ids } });
    if (charge.status === "success") {
      const order = await getOrderForPayment(orderId);
      if (order) await announcePaid(order, payment.id, log, { renewal: true });
    }
    return "charged";
  }

  // 3. Declined: cancel this order, try again later, tell the customer.
  await markPaymentFailed(payment.id, charge.raw ?? { message: charge.message });
  await pool.query(`UPDATE orders SET status = 'CANCELLED', fulfilment_stage = 'cancelled' WHERE id = $1`, [orderId]);
  const tries = attempt + 1;
  const final = tries >= MAX_TRIES;
  await pool.query(
    `UPDATE subscriptions SET status = $2, failed_attempts = $3, last_failed_at = now(), next_charge_at = $4::timestamptz + make_interval(days => ${RETRY_DAYS}) WHERE id = ANY($1::uuid[])`,
    [ids, final ? "paused" : "past_due", tries, now]);
  await logEvent({ type: "payment", message: `Subscription payment declined for ${names.join(", ")} (try ${tries} of ${MAX_TRIES})${final ? ": paused" : ""}`, userId: first.user_id,
    meta: { orderId, orderNumber, subscriptionIds: ids, reason: charge.message ?? null, tries } });
  await emailOnce("renewal_failed", renewalKey, first.email, final ? "Your subscription is paused" : "Your subscription payment didn't go through", "renewal_failed",
    { firstName: first.first_name ?? "", products: names, reason: charge.message ?? "", link: `${appUrl()}/account?tab=subscriptions`, final, retryDays: RETRY_DAYS }, first.user_id);
  return "failed";
}
