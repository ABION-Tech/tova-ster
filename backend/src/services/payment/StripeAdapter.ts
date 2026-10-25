import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProviderAdapter, PaymentIntent, VerifyResult } from "./PaymentService.js";

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
    });

    const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Same order + amount retried within 24h reuses the same session.
        "Idempotency-Key": `${orderNumber}-${params.amountMinor}-${params.reference}`,
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
    const res = await fetch(`${STRIPE_BASE}/checkout/sessions/${encodeURIComponent(reference)}`, {
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
