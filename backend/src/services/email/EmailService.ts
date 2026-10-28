import { logEvent, maskEmail } from "../../events/eventsRepo.js";
import { pool } from "../../db/pool.js";
import { MARKETING_TEMPLATES, oneClickUrl, unsubscribePageUrl } from "./unsubscribe.js";

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
  headers?: Record<string, string>;
}

export interface EmailProviderAdapter {
  send(payload: EmailPayload): Promise<{ id: string }>;
}

export class EmailService {
  constructor(private readonly adapter: EmailProviderAdapter) {}

  /** Sends, and records the send or the failure in the activity log (recipient masked). */
  async send(payload: EmailPayload, userId?: string | null) {
    // Marketing emails: never to someone who unsubscribed, and always with an
    // unsubscribe link in the footer plus the mail-app one-click headers.
    if (MARKETING_TEMPLATES.has(payload.template)) {
      const e = payload.to.trim().toLowerCase();
      const off = await pool.query(
        `SELECT 1 FROM users WHERE lower(email) = $1 AND unsubscribed_at IS NOT NULL
         UNION ALL SELECT 1 FROM newsletter_subscribers WHERE lower(email) = $1 AND unsubscribed_at IS NOT NULL LIMIT 1`, [e]);
      if (off.rowCount) return { id: "skipped-unsubscribed" };
      payload = {
        ...payload,
        data: { ...(payload.data ?? {}), unsubscribeUrl: unsubscribePageUrl(e) },
        headers: { ...(payload.headers ?? {}), "List-Unsubscribe": `<${oneClickUrl(e)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    }
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
