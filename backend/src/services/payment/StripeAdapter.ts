import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChargeResult, ChargeSavedParams, PaymentProviderAdapter, PaymentIntent, RefundResult, SavedMethod, VerifyResult } from "./PaymentService.js";

const STRIPE_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com/v1"; // override only for local mock tests
const WEBHOOK_TOLERANCE_SECONDS = 300;

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("StripeAdapter: STRIPE_SECRET_KEY is not configured.");
  return key;
}

function webhookSecret(): string {
  const key = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key) throw new Error("StripeAdapter: STRIPE_WEBHOOK_SECRET is not configured.");
  return key;
}

// Stripe's REST API takes form-encoded bodies with bracketed keys.
function form(params: Record<string, string | number | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, String(v));
  return body;
}

type StripeSession = {
  id: string;
  url?: string;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  client_reference_id: string | null;
};

function mapStatus(s: StripeSession): PaymentIntent["status"] {
  if (s.payment_status === "paid") return "success";
  if (s.status === "expired") return "cancelled";
  // Open or complete-but-unpaid (delayed methods such as bank debits): not final yet.
  return "pending";
}

/**
 * Only this file may call api.stripe.com. Uses Stripe-hosted Checkout, so
 * card data never touches our servers (PCI SAQ-A), and Apple Pay, Google Pay
 * and any other methods switched on in the Stripe dashboard (Link, PayPal,
 * Klarna, Clearpay) appear automatically — no per-method code here.
 *
 * Our payment `reference` is Stripe's Checkout Session id (cs_...), so a
 * webhook or return-URL can always be re-verified with one GET.
 */
export class StripeAdapter implements PaymentProviderAdapter {
  async createPaymentIntent(params: {
    amountMinor: number;
    currency: string;
    reference: string;
    customerEmail: string;
    metadata?: Record<string, unknown>;
    saveCard?: boolean;
  }): Promise<PaymentIntent> {
    const appUrl = process.env.APP_URL;
    if (!appUrl) throw new Error("StripeAdapter: APP_URL is not configured.");
    const orderNumber = String(params.metadata?.orderNumber ?? params.reference);

    const body = form({
      mode: "payment",
      customer_email: params.customerEmail,
      client_reference_id: params.reference,
      success_url: `${appUrl}/checkout/callback?reference={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/checkout?cancelled=1`,
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": params.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": params.amountMinor,
      "line_items[0][price_data][product_data][name]": `Tova-ster order ${orderNumber}`,
      "metadata[orderId]": String(params.metadata?.orderId ?? ""),
      "metadata[orderNumber]": orderNumber,
      "payment_intent_data[metadata][orderNumber]": orderNumber,
      "payment_intent_data[description]": `Tova-ster order ${orderNumber}`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
      // Subscribe & Save: keep the card (with Stripe) so later deliveries can be charged.
      // Stripe then only offers methods that can be reused (cards, Apple Pay, Google Pay, Link).
      ...(params.saveCard ? { customer_creation: "always", "payment_intent_data[setup_future_usage]": "off_session" } : {}),
    });

    const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Same order + amount retried within 24h reuses the same session.
        "Idempotency-Key": `${orderNumber}-${params.amountMinor}-${params.reference}${params.saveCard ? "-save" : ""}`,
      },
      body,
    });
    const session = (await res.json()) as StripeSession & { error?: { message: string } };
    if (!res.ok || !session.url) {
      throw new Error(`Stripe session create failed: ${session.error?.message ?? res.status}`);
    }

    return {
      id: session.id,
      provider: "stripe",
      amountMinor: params.amountMinor,
      currency: params.currency,
      status: "pending",
      reference: session.id,
      checkoutUrl: session.url,
    };
  }

  // The call this whole flow trusts: ask Stripe directly for the session.
  async verifyTransaction(reference: string): Promise<VerifyResult> {
    // payment_intent expanded so a saved card (Subscribe & Save) can be read from the result.
    const res = await fetch(`${STRIPE_BASE}/checkout/sessions/${encodeURIComponent(reference)}?expand[]=payment_intent`, {
      headers: { Authorization: `Bearer ${secretKey()}` },
    });
    const session = (await res.json()) as StripeSession & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe verify failed: ${session.error?.message ?? res.status}`);

    return {
      verified: session.payment_status === "paid",
      reference: session.id,
      amountMinor: session.amount_total ?? 0,
      currency: (session.currency ?? "").toUpperCase(),
      status: mapStatus(session),
      raw: session,
    };
  }

  /**
   * Refunds against the Checkout Session's PaymentIntent. Stripe sends the
   * money back to the card (or wallet) it came from.
   */
  async refund(params: { reference: string; amountMinor: number; idempotencyKey: string; note?: string }): Promise<RefundResult> {
    const s = await fetch(`${STRIPE_BASE}/checkout/sessions/${encodeURIComponent(params.reference)}`, { headers: { Authorization: `Bearer ${secretKey()}` } });
    const session = (await s.json()) as { payment_intent?: string | { id: string } | null; error?: { message: string } };
    if (!s.ok) throw new Error(`Stripe: couldn't find the payment (${session.error?.message ?? s.status}).`);
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!pi) throw new Error("Stripe: this checkout has no payment to refund.");
    const res = await fetch(`${STRIPE_BASE}/refunds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": params.idempotencyKey },
      body: form({ payment_intent: pi, amount: params.amountMinor, reason: "requested_by_customer", "metadata[note]": params.note?.slice(0, 450) }),
    });
    const r = (await res.json()) as { id?: string; status?: string; error?: { message: string } };
    if (!res.ok || !r.id) throw new Error(`Stripe refund failed: ${r.error?.message ?? res.status}`);
    const status = r.status === "succeeded" ? "succeeded" : r.status === "failed" || r.status === "canceled" ? "failed" : "pending";
    return { id: r.id, status };
  }

  /** The customer and card Stripe saved at checkout (from the verified session). */
  savedMethod(raw: unknown): SavedMethod | null {
    const r = raw as { customer?: string | { id: string } | null; payment_intent?: { payment_method?: string | { id: string } | null } | string | null };
    const customerId = typeof r?.customer === "string" ? r.customer : r?.customer?.id;
    const pi = r?.payment_intent;
    const pm = pi && typeof pi === "object" ? (typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id) : undefined;
    return customerId && pm ? { customerId, paymentMethodId: pm } : null;
  }

  /** Charges a saved card with the customer not present (a renewal). */
  async chargeSaved(p: ChargeSavedParams): Promise<ChargeResult> {
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.metadata ?? {})) meta[`metadata[${k}]`] = v;
    const res = await fetch(`${STRIPE_BASE}/payment_intents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": p.idempotencyKey },
      body: form({ amount: p.amountMinor, currency: p.currency.toLowerCase(), customer: p.customerId, payment_method: p.paymentMethodId,
        off_session: "true", confirm: "true", description: p.description, ...meta }),
    });
    const r = (await res.json()) as { id?: string; status?: string; error?: { message?: string; decline_code?: string; payment_intent?: { id: string; status: string } } };
    if (r.error) {
      // Declined, or the bank wants the customer to confirm (3-D Secure): they need to update their card.
      return { reference: r.error.payment_intent?.id ?? `failed-${p.idempotencyKey}`, status: "failed", message: r.error.message ?? "The card was declined.", raw: r };
    }
    const status = r.status === "succeeded" ? "success" : r.status === "processing" ? "pending" : "failed";
    return { reference: r.id ?? "", status, message: status === "failed" ? "The bank asked the customer to confirm this payment." : undefined, raw: r };
  }

  /** Stripe-hosted page to save a new card (setup mode); comes back to returnUrl with card_ref. */
  async startCardUpdate(p: { customerId: string | null; email: string; returnUrl: string }): Promise<{ url: string; reference: string }> {
    let customer = p.customerId;
    if (!customer) {
      const c = await fetch(`${STRIPE_BASE}/customers`, { method: "POST", headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form({ email: p.email }) });
      const cj = (await c.json()) as { id?: string; error?: { message: string } };
      if (!cj.id) throw new Error(`Stripe customer create failed: ${cj.error?.message ?? c.status}`);
      customer = cj.id;
    }
    const sep = p.returnUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ mode: "setup", customer, currency: "gbp", "payment_method_types[0]": "card",
        success_url: `${p.returnUrl}${sep}card_ref={CHECKOUT_SESSION_ID}`, cancel_url: p.returnUrl }),
    });
    const s = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!s.id || !s.url) throw new Error(`Stripe card update failed: ${s.error?.message ?? res.status}`);
    return { url: s.url, reference: s.id };
  }

  async finishCardUpdate(reference: string): Promise<SavedMethod | null> {
    const res = await fetch(`${STRIPE_BASE}/checkout/sessions/${encodeURIComponent(reference)}?expand[]=setup_intent`, { headers: { Authorization: `Bearer ${secretKey()}` } });
    const s = (await res.json()) as { mode?: string; status?: string; customer?: string | null; setup_intent?: { status?: string; payment_method?: string | { id: string } | null } | null };
    if (!res.ok || s.mode !== "setup" || s.status !== "complete" || s.setup_intent?.status !== "succeeded") return null;
    const pm = typeof s.setup_intent.payment_method === "string" ? s.setup_intent.payment_method : s.setup_intent.payment_method?.id;
    return s.customer && pm ? { customerId: s.customer, paymentMethodId: pm } : null;
  }

  // Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of `${t}.${rawBody}`>[,v1=...]
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    const parts = signatureHeader.split(",").map((p) => p.split("="));
    const t = parts.find(([k]) => k === "t")?.[1];
    const candidates = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!t || candidates.length === 0) return false;

    const age = Math.abs(Date.now() / 1000 - Number(t));
    if (!Number.isFinite(age) || age > WEBHOOK_TOLERANCE_SECONDS) return false;

    const expected = Buffer.from(createHmac("sha256", webhookSecret()).update(`${t}.${rawBody}`).digest("hex"), "utf8");
    return candidates.some((c) => {
      const given = Buffer.from(c ?? "", "utf8");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  }
}
