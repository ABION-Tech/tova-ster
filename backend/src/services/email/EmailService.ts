import { logEvent, maskEmail } from "../../events/eventsRepo.js";

/**
 * EmailService — the ONLY thing business logic is allowed to call for any
 * outbound email (verification, password reset, order/payment/shipping
 * confirmations, admin alerts, abandoned-cart reminders). No feature code
 * may import the Resend SDK directly. Wired for real in Stage 10.
 */

export interface EmailPayload {
  to: string;
  subject: string;
  template: string; // branded template identifier, not raw HTML from callers
  data?: Record<string, unknown>;
}

export interface EmailProviderAdapter {
  send(payload: EmailPayload): Promise<{ id: string }>;
}

export class EmailService {
  constructor(private readonly adapter: EmailProviderAdapter) {}

  /** Sends, and records the send or the failure in the activity log (recipient masked). */
  async send(payload: EmailPayload, userId?: string | null) {
    const meta = { template: payload.template, to: maskEmail(payload.to), orderNumber: (payload.data?.orderNumber as string | undefined) ?? null };
    try {
      const out = await this.adapter.send(payload);
      await logEvent({ type: "email", message: `Sent "${payload.subject}"`, userId: userId ?? null, meta: { ...meta, id: out.id } });
      return out;
    } catch (err) {
      await logEvent({ type: "email", message: `Email failed: "${payload.subject}"`, userId: userId ?? null, meta: { ...meta, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" } });
      throw err;
    }
  }
}
