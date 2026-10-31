import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { getSetting } from "../settings/settingsRepo.js";
import { emailService } from "../services/email/index.js";
import { quoteSubscriptions } from "../subscriptions/renewals.js";

/**
 * Timed emails, run every hour by startDailyJobs. Each one is switched on or
 * off in Admin › Emails. Every send is claimed once in email_sends (kind + ref)
 * before it goes, so a repeat run never sends twice; a failed send releases
 * its claim and is tried again next hour.
 *
 * Marketing emails (basket reminders, points, win-back) only go to people who
 * agreed to emails and haven't unsubscribed; EmailService adds the unsubscribe
 * link. Service emails (subscription reminder, review request, back in stock)
 * go to everyone they concern.
 */

const appUrl = () => (process.env.APP_URL ?? "https://tova-ster.com").replace(/\/$/, "");
const DAY = 24 * 60 * 60 * 1000;

/** People who agreed to marketing emails (account tick box or newsletter) and haven't unsubscribed. */
export const CONSENTED = (emailExpr: string) => `(
  EXISTS (SELECT 1 FROM users cu WHERE lower(cu.email) = lower(${emailExpr}) AND cu.marketing_email IS TRUE AND cu.unsubscribed_at IS NULL)
  OR EXISTS (SELECT 1 FROM newsletter_subscribers cn WHERE lower(cn.email) = lower(${emailExpr}) AND cn.unsubscribed_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM users cx WHERE lower(cx.email) = lower(${emailExpr}) AND cx.unsubscribed_at IS NOT NULL))
)`;

/** Claims (kind, ref) then sends; returns true if this run sent it. */
async function sendOnce(kind: string, ref: string, to: string, subject: string, template: string, data: Record<string, unknown>, userId?: string | null): Promise<boolean> {
  const claim = await pool.query(`INSERT INTO email_sends (kind, ref, email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [kind, ref, to.toLowerCase()]);
  if (!claim.rowCount) return false;
  try {
    const out = await emailService.send({ to, subject, template, data }, userId ?? null);
    return out.id !== "skipped-unsubscribed";
  } catch {
    await pool.query(`DELETE FROM email_sends WHERE kind = $1 AND ref = $2`, [kind, ref]); // try again next run
    return false;
  }
}

type Line = { name: string; qty: number; slug: string | null };

/** Basket reminders after each step (days since the basket was last touched); a one-use code on the last one. */
export async function runBasketReminders(now = new Date()): Promise<number> {
  const e = await getSetting("emails");
  if (!e.basket) return 0;
  const steps = [...new Set((e.basketSteps as number[]).map(Number).filter((n) => n > 0 && n <= 30))].sort((a, b) => a - b);
  if (!steps.length) return 0;
  const minHours = Math.max(1, Number(e.basketAfterHours) || 24);
  const r = await pool.query<{ id: string; user_id: string | null; email: string; first_name: string | null; last_activity_at: Date; items: Line[] }>(
    `SELECT c.id, c.user_id, COALESCE(u.email, c.email) AS email, u.first_name, c.last_activity_at,
            (SELECT json_agg(json_build_object('name', p.name, 'qty', ci.quantity, 'slug', p.slug) ORDER BY p.name)
               FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = c.id) AS items
     FROM carts c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.status = 'active'
       AND COALESCE(u.email, c.email) IS NOT NULL AND (u.id IS NULL OR u.erased_at IS NULL)
       AND c.last_activity_at < $1::timestamptz - make_interval(hours => $2::int)
       AND c.last_activity_at > $1::timestamptz - make_interval(days => $3::int)
       AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
       AND ${CONSENTED("COALESCE(u.email, c.email)")}
       -- not if they've paid for an order since they last touched the basket
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE (o.user_id = c.user_id OR lower(o.guest_email) = lower(COALESCE(u.email, c.email)))
                       AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED') AND o.created_at > c.last_activity_at)`,
    [now, minHours, steps.at(-1)! + 1],
  );
  let sent = 0;
  for (const c of r.rows) {
    const ageDays = (now.getTime() - new Date(c.last_activity_at).getTime()) / DAY;
    const due = steps.filter((s) => ageDays >= s);
    if (!due.length) continue;
    const step = due.at(-1)!;
    const stamp = new Date(c.last_activity_at).toISOString();
    const last = step === steps.at(-1);
    // Skip if this step (for this version of the basket) has gone already.
    const done = await pool.query(`SELECT 1 FROM email_sends WHERE kind = 'basket' AND ref = $1`, [`${c.id}:${stamp}:${step}`]);
    if (done.rowCount) continue;
    let code: string | null = null;
    if (last && e.basketCodeOn && Number(e.basketCode) > 0) {
      code = `BACK${randomBytes(4).toString("hex").toUpperCase()}`;
      await pool.query(
        `INSERT INTO discount_codes (code, pct, active, note, max_uses, expires_at, first_order_only) VALUES ($1, $2, true, $3, 1, now() + interval '7 days', false)`,
        [code, Math.min(50, Number(e.basketCode)), `Basket reminder (one use, 7 days)`],
      );
    }
    const ok = await sendOnce("basket", `${c.id}:${stamp}:${step}`, c.email, step === steps[0] ? "You left something in your basket" : "Still thinking it over?", "basket_reminder",
      { firstName: c.first_name ?? "", items: c.items ?? [], link: `${appUrl()}/checkout`, code, pct: code ? Math.min(50, Number(e.basketCode)) : null, step: due.length, steps: steps.length },
      c.user_id);
    if (!ok && code) await pool.query(`DELETE FROM discount_codes WHERE code = $1 AND uses = 0`, [code]);
    if (ok) sent++;
  }
  return sent;
}

/** A few days before each subscription delivery (Admin › Dispatch "days before"), with how to skip or change it. */
export async function runSubscriptionReminders(now = new Date()): Promise<number> {
  const e = await getSetting("emails");
  if (!e.subReminder) return 0;
  const d = await getSetting("dispatch");
  const days = Math.min(14, Math.max(1, Number(d.subsDays) || 3));
  const r = await pool.query<{ id: string; user_id: string | null; email: string; first_name: string | null; product_name: string; quantity: number; amount: number; next_charge_at: Date; interval_months: number; product_id: string | null; price: number | null; vat: number | null }>(
    `SELECT s.id, s.user_id, COALESCE(u.email, s.email) AS email, u.first_name, s.product_name, s.quantity,
            (s.unit_price * s.quantity)::float AS amount, s.next_charge_at, s.interval_months,
            p.id AS product_id, p.base_price::float AS price, p.vat_rate::float AS vat
     FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN products p ON p.id = s.product_id
     WHERE s.status = 'active' AND s.next_charge_at > $1 AND s.next_charge_at <= $1::timestamptz + make_interval(days => $2::int)
       AND (u.id IS NULL OR u.erased_at IS NULL)`,
    [now, days],
  );
  let sent = 0;
  for (const s of r.rows) {
    const when = new Date(s.next_charge_at);
    // The same price the renewal will charge: today's price less today's Subscribe & Save discount.
    if (s.product_id && s.price !== null) {
      const q = await quoteSubscriptions([{ id: s.id, productId: s.product_id, name: s.product_name, price: s.price, vat: s.vat ?? 20, quantity: s.quantity, months: s.interval_months }], null);
      s.amount = q.merchandise;
    }
    const ok = await sendOnce("sub_reminder", `${s.id}:${when.toISOString().slice(0, 10)}`, s.email, `Your ${s.product_name} is on its way soon`, "subscription_reminder", {
      firstName: s.first_name ?? "", product: s.product_name, quantity: s.quantity, amount: s.amount,
      date: when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }),
      every: s.interval_months, link: `${appUrl()}/account?tab=subscriptions`,
    }, s.user_id);
    if (ok) sent++;
  }
  return sent;
}

/** Asks for a review a few days after delivery, for products the customer hasn't reviewed yet. */
export async function runReviewRequests(now = new Date()): Promise<number> {
  const [e, f] = await Promise.all([getSetting("emails"), getSetting("features")]);
  if (!e.review || !f.reviews?.on) return 0;
  const r = await pool.query<{ id: string; order_number: string; user_id: string; email: string; first_name: string; items: Line[] }>(
    `SELECT o.id, o.order_number, o.user_id, u.email, u.first_name,
            (SELECT json_agg(DISTINCT jsonb_build_object('name', p.name, 'slug', p.slug))
               FROM order_items oi JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = o.id AND p.status IN ('active','out_of_stock')
                AND NOT EXISTS (SELECT 1 FROM product_reviews pr WHERE pr.product_id = p.id AND pr.user_id = o.user_id)) AS items
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.status = 'DELIVERED' AND u.erased_at IS NULL
       AND o.delivered_at < $1::timestamptz - interval '3 days' AND o.delivered_at > $1::timestamptz - interval '30 days'`,
    [now],
  );
  let sent = 0;
  for (const o of r.rows) {
    if (!o.items?.length) continue;
    const ok = await sendOnce("review", o.id, o.email, "How are you getting on?", "review_request", {
      firstName: o.first_name, orderNumber: o.order_number,
      items: o.items.map((i) => ({ name: i.name, link: `${appUrl()}/products/${i.slug}#reviews` })),
    }, o.user_id);
    if (ok) sent++;
  }
  return sent;
}

/** Tells people who asked when a sold-out product is back. */
export async function runBackInStock(): Promise<number> {
  const e = await getSetting("emails");
  if (!e.backInStock) return 0;
  const r = await pool.query<{ id: string; email: string; name: string; slug: string }>(
    `SELECT a.id, a.email, p.name, p.slug FROM stock_alerts a JOIN products p ON p.id = a.product_id
     WHERE a.notified_at IS NULL AND p.status = 'active'
       AND (COALESCE(p.stock, 0) > 0 OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0))
     ORDER BY a.created_at LIMIT 500`,
  );
  let sent = 0;
  for (const a of r.rows) {
    const ok = await sendOnce("back_in_stock", a.id, a.email, `${a.name} is back in stock`, "back_in_stock", { product: a.name, link: `${appUrl()}/products/${a.slug}` });
    // Done with the address once the email has gone: keep only that it was sent.
    if (ok) { await pool.query(`UPDATE stock_alerts SET notified_at = now(), email = 'sent' WHERE id = $1`, [a.id]); sent++; }
  }
  return sent;
}

/** Monthly nudge when a customer has enough points to spend. */
export async function runPointsUpdates(now = new Date()): Promise<number> {
  const [e, f] = await Promise.all([getSetting("emails"), getSetting("features")]);
  if (!e.points || !f.rewards?.on) return 0;
  const min = Math.max(1, Number(f.rewards.minRedeem) || 500);
  const value = Number(f.rewards.pointValue) || 1;
  const r = await pool.query<{ id: string; email: string; first_name: string; points_balance: number }>(
    `SELECT u.id, u.email, u.first_name, u.points_balance FROM users u
     WHERE u.erased_at IS NULL AND u.points_balance >= $1 AND ${CONSENTED("u.email")}
       AND NOT EXISTS (SELECT 1 FROM email_sends s WHERE s.kind = 'points' AND lower(s.email) = lower(u.email) AND s.sent_at > $2::timestamptz - interval '30 days')`,
    [min, now],
  );
  let sent = 0;
  const month = now.toISOString().slice(0, 7);
  for (const u of r.rows) {
    const ok = await sendOnce("points", `${u.id}:${month}`, u.email, `You have ${u.points_balance} points to spend`, "points_update",
      { firstName: u.first_name, points: u.points_balance, pounds: (u.points_balance * value) / 100, link: `${appUrl()}/shop` }, u.id);
    if (ok) sent++;
  }
  return sent;
}

/** "We miss you" to customers whose last paid order was a while ago (once per last order). */
export async function runWinback(now = new Date()): Promise<number> {
  const e = await getSetting("emails");
  if (!e.winback) return 0;
  const days = Math.min(365, Math.max(14, Number(e.winbackDays) || 60));
  const r = await pool.query<{ id: string; email: string; first_name: string; points_balance: number; last_id: string }>(
    `SELECT u.id, u.email, u.first_name, u.points_balance, lo.id AS last_id
     FROM users u
     JOIN LATERAL (SELECT o.id, o.created_at FROM orders o WHERE o.user_id = u.id AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')
                   ORDER BY o.created_at DESC LIMIT 1) lo ON true
     WHERE u.erased_at IS NULL
       AND lo.created_at < $1::timestamptz - make_interval(days => $2::int)
       AND lo.created_at > $1::timestamptz - make_interval(days => $2::int + 30)
       AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active')
       AND ${CONSENTED("u.email")}`,
    [now, days],
  );
  let sent = 0;
  for (const u of r.rows) {
    const ok = await sendOnce("winback", `${u.id}:${u.last_id}`, u.email, "It's been a while", "winback",
      { firstName: u.first_name, points: u.points_balance, link: `${appUrl()}/shop`, quizLink: `${appUrl()}/quiz` }, u.id);
    if (ok) sent++;
  }
  return sent;
}

/** All timed emails, in one go. Returns how many of each were sent. */
export async function runTimedEmails(now = new Date()) {
  const out: Record<string, number> = {};
  for (const [k, fn] of [
    ["basket", () => runBasketReminders(now)], ["subscription", () => runSubscriptionReminders(now)], ["review", () => runReviewRequests(now)],
    ["backInStock", () => runBackInStock()], ["points", () => runPointsUpdates(now)], ["winback", () => runWinback(now)],
  ] as const) {
    out[k] = await fn();
  }
  return out;
}
