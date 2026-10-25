import type {
  PaymentProviderAdapter,
  PaymentIntent,
  VerifyResult,
} from "./PaymentService.js";

/**
 * Stubbed for future activation — Flutterwave is the optional secondary
 * provider per the PRD. Not wired in V1 unless the client requires it.
 */
export class FlutterwaveAdapter implements PaymentProviderAdapter {
  async createPaymentIntent(): Promise<PaymentIntent> {
    throw new Error("FlutterwaveAdapter: not implemented — optional/future provider");
  }

  async verifyTransaction(): Promise<VerifyResult> {
    throw new Error("FlutterwaveAdapter: not implemented — optional/future provider");
  }

  verifyWebhookSignature(): boolean {
    throw new Error("FlutterwaveAdapter: not implemented — optional/future provider");
  }
}
