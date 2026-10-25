import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProviderAdapter, PaymentIntent, VerifyResult } from "./PaymentService.js";

const PAYSTACK_BASE = "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PaystackAdapter: PAYSTACK_SECRET_KEY is not configured.");
  return key;
}

function mapStatus(paystackStatus: string): PaymentIntent["status"] {
  if (paystackStatus === "success") return "success";
  if (paystackStatus === "abandoned") return "cancelled";
  return "failed";
}

/**
 * Only this file may import/call anything Paystack-specific — application
 * code (checkout, webhook route, order logic) only ever calls
 * PaymentService, which is typed against PaymentProviderAdapter, not this
 * class. Plain REST calls, no SDK dependency, per the PRD's portability
 * requirement (swapping providers later is a new adapter file, not a
 * rewrite of anything that calls PaymentService).
 */
export class PaystackAdapter implements PaymentProviderAdapter {
  async createPaymentIntent(params: {
    amountMinor: number;
    currency: string;
    reference: string;
    customerEmail: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentIntent> {
    const callbackUrl = process.env.APP_URL ? `${process.env.APP_URL}/checkout/callback` : undefined;

    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: params.customerEmail,
        amount: params.amountMinor,
        currency: params.currency,
        reference: params.reference,
        callback_url: callbackUrl,
        metadata: params.metadata,
      }),
    });

    const body = await res.json();
    if (!res.ok || !body.status) {
      throw new Error(`Paystack initialize failed: ${body.message ?? res.status}`);
    }

    return {
      id: params.reference,
      provider: "paystack",
      amountMinor: params.amountMinor,
      currency: params.currency,
      status: "pending",
      reference: params.reference,
      checkoutUrl: body.data.authorization_url,
    };
  }

  // The one call this whole flow actually trusts — hits Paystack directly
  // for the current state of the transaction, independent of what a
  // webhook payload or a frontend redirect claims.
  async verifyTransaction(reference: string): Promise<VerifyResult> {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey()}` },
    });
    const body = await res.json();
    if (!res.ok || !body.status) {
      throw new Error(`Paystack verify failed: ${body.message ?? res.status}`);
    }

    const data = body.data;
    return {
      verified: data.status === "success",
      reference: data.reference,
      amountMinor: data.amount,
      status: mapStatus(data.status),
      raw: data,
    };
  }

  // Paystack signs webhook bodies as HMAC-SHA512(rawBody, secretKey), hex.
  // Rejecting on any mismatch — including a missing header — is what makes
  // a spoofed webhook call fail closed rather than open.
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac("sha512", secretKey()).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signatureHeader, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
