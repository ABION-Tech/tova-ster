/**
 * PaymentService — the ONLY thing business logic is allowed to call for payments.
 * No feature code may import a Stripe/Paystack/Flutterwave SDK directly. Ever.
 *
 * Provider for UK launch: Stripe (hosted Checkout). Paystack/Flutterwave remain as inactive adapters.
 * every later stage (checkout, webhooks, admin order view) builds against
 * this contract instead of a vendor SDK.
 */

export interface PaymentIntent {
  id: string;
  provider: "stripe" | "paystack" | "flutterwave";
  amountMinor: number; // smallest currency unit: pence for GBP
  currency: string;
  status: "pending" | "success" | "failed" | "cancelled";
  reference: string;
  checkoutUrl?: string;
}

export interface VerifyResult {
  verified: boolean;
  reference: string;
  amountMinor: number;
  currency?: string;
  status: PaymentIntent["status"];
  raw?: unknown;
}

export interface PaymentProviderAdapter {
  createPaymentIntent(params: {
    amountMinor: number;
    currency: string;
    reference: string;
    customerEmail: string;
    metadata?: Record<string, unknown>;
    saveCard?: boolean; // keep the card for Subscribe & Save renewals
  }): Promise<PaymentIntent>;

  // Backend-side re-verification against the provider's API — never trust
  // a frontend "success" redirect or an unverified webhook payload.
  verifyTransaction(reference: string): Promise<VerifyResult>;

  // Validates a webhook payload's signature against the raw request body.
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;

  // Gives money back for a payment (whole or part). The key makes a retried
  // call return the same refund instead of paying out twice.
  refund?(params: { reference: string; amountMinor: number; idempotencyKey: string; note?: string }): Promise<RefundResult>;

  // Subscribe & Save: the saved card from a verified payment, charging it
  // later without the customer present, and replacing it.
  savedMethod?(raw: unknown): SavedMethod | null;
  chargeSaved?(params: ChargeSavedParams): Promise<ChargeResult>;
  startCardUpdate?(params: { customerId: string | null; email: string; returnUrl: string }): Promise<{ url: string; reference: string }>;
  finishCardUpdate?(reference: string): Promise<SavedMethod | null>;
}

export interface SavedMethod { customerId: string; paymentMethodId: string }
export interface ChargeSavedParams {
  customerId: string; paymentMethodId: string; amountMinor: number; currency: string;
  idempotencyKey: string; description: string; metadata?: Record<string, string>;
}
export interface ChargeResult {
  reference: string;                                // the provider's id for this charge
  status: "success" | "pending" | "failed";
  message?: string;                                 // why it failed, in the bank's words
  raw?: unknown;
}

export interface RefundResult {
  id: string;
  status: "succeeded" | "pending" | "failed";
}

export class PaymentService {
  constructor(private readonly adapter: PaymentProviderAdapter) {}

  createPaymentIntent(
    params: Parameters<PaymentProviderAdapter["createPaymentIntent"]>[0],
  ) {
    return this.adapter.createPaymentIntent(params);
  }

  verifyTransaction(reference: string) {
    return this.adapter.verifyTransaction(reference);
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string) {
    return this.adapter.verifyWebhookSignature(rawBody, signatureHeader);
  }

  get canRenew(): boolean {
    return Boolean(this.adapter.chargeSaved && this.adapter.savedMethod);
  }

  savedMethod(raw: unknown): SavedMethod | null {
    return this.adapter.savedMethod?.(raw) ?? null;
  }

  chargeSaved(params: ChargeSavedParams): Promise<ChargeResult> {
    if (!this.adapter.chargeSaved) throw new Error("This payment provider can't charge saved cards.");
    return this.adapter.chargeSaved(params);
  }

  startCardUpdate(params: { customerId: string | null; email: string; returnUrl: string }) {
    if (!this.adapter.startCardUpdate) throw new Error("This payment provider can't update saved cards.");
    return this.adapter.startCardUpdate(params);
  }

  finishCardUpdate(reference: string) {
    if (!this.adapter.finishCardUpdate) throw new Error("This payment provider can't update saved cards.");
    return this.adapter.finishCardUpdate(reference);
  }

  refund(params: { reference: string; amountMinor: number; idempotencyKey: string; note?: string }): Promise<RefundResult> {
    if (!this.adapter.refund) throw new Error("This payment provider can't refund from here. Refund it in the provider's dashboard.");
    return this.adapter.refund(params);
  }
}
