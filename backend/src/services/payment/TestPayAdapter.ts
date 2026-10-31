import { createHash, randomBytes } from "node:crypto";
import type { ChargeResult, ChargeSavedParams, PaymentIntent, PaymentProviderAdapter, RefundResult, SavedMethod, VerifyResult } from "./PaymentService.js";

/**
 * Local and staging only (PAYMENT_PROVIDER=test). Lets the whole checkout be
 * clicked through before Stripe keys exist: "checkout" is a page on our own
 * storefront with Pay / Cancel buttons. Refuses to run in production.
 * Amounts are kept in memory, so a restart forgets unpaid test sessions.
 */
const sessions = new Map<string, { amountMinor: number; currency: string; paid: boolean }>();

export class TestPayAdapter implements PaymentProviderAdapter {
  constructor() {
    if (process.env.NODE_ENV === "production") throw new Error("TestPayAdapter must never run in production.");
  }

  async createPaymentIntent(params: { amountMinor: number; currency: string; reference: string }): Promise<PaymentIntent> {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const reference = `test_${randomBytes(12).toString("hex")}`;
    sessions.set(reference, { amountMinor: params.amountMinor, currency: params.currency, paid: false });
    return {
      id: reference, provider: "stripe", amountMinor: params.amountMinor, currency: params.currency, status: "pending", reference,
      checkoutUrl: `${appUrl}/checkout/test-pay?reference=${reference}`,
    };
  }

  /** Called by the test checkout page's Pay button (via /webhooks/test). */
  static markPaid(reference: string): boolean {
    const s = sessions.get(reference);
    if (!s) return false;
    s.paid = true;
    return true;
  }

  async verifyTransaction(reference: string): Promise<VerifyResult> {
    const s = sessions.get(reference);
    if (!s) return { verified: false, reference, amountMinor: 0, status: "failed" };
    return { verified: s.paid, reference, amountMinor: s.amountMinor, currency: s.currency, status: s.paid ? "success" : "pending", raw: { test: true } };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }

  /** Pretend saved card. A card id containing "decline" is refused, to test failed renewals. */
  savedMethod(): SavedMethod { return { customerId: "cus_test", paymentMethodId: "pm_test_card" }; }

  async chargeSaved(p: ChargeSavedParams): Promise<ChargeResult> {
    const reference = `pi_test_${createHash("sha256").update(p.idempotencyKey).digest("hex").slice(0, 24)}`;
    if (p.paymentMethodId.includes("decline")) return { reference, status: "failed", message: "Your card was declined (test).", raw: { test: true } };
    return { reference, status: "success", raw: { test: true, amount: p.amountMinor } };
  }

  async startCardUpdate(p: { returnUrl: string }): Promise<{ url: string; reference: string }> {
    const reference = `setup_test_${randomBytes(8).toString("hex")}`;
    return { url: `${p.returnUrl}${p.returnUrl.includes("?") ? "&" : "?"}card_ref=${reference}`, reference };
  }

  async finishCardUpdate(reference: string): Promise<SavedMethod | null> {
    return reference.startsWith("setup_test_") ? { customerId: "cus_test", paymentMethodId: "pm_test_card" } : null;
  }

  /** Pretend refund: always succeeds (same key, same id, like Stripe). */
  async refund(params: { amountMinor: number; idempotencyKey: string }): Promise<RefundResult> {
    return { id: `re_test_${createHash("sha256").update(params.idempotencyKey).digest("hex").slice(0, 24)}`, status: "succeeded" };
  }
}
