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
  }): Promise<PaymentIntent>;

  // Backend-side re-verification against the provider's API — never trust
  // a frontend "success" redirect or an unverified webhook payload.
  verifyTransaction(reference: string): Promise<VerifyResult>;

  // Validates a webhook payload's signature against the raw request body.
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
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
}
