import type { EmailProviderAdapter, EmailPayload } from "./EmailService.js";
import { randomUUID } from "node:crypto";

/**
 * Stands in for ResendAdapter until Stage 10 wires the real Resend account
 * and branded templates. Business logic (registration, password reset,
 * etc.) already calls `EmailService.send()` exclusively — Stage 10 swaps
 * this line in `index.ts` for a `ResendAdapter`, and nothing else in the
 * app changes. Used in every environment, including production, until
 * that swap happens — there's no real adapter to fall back to yet, and
 * this logs a `to`/`subject`/`data` line wherever the process's stdout
 * goes, which is enough to test the auth flows end to end.
 */
export class ConsoleEmailAdapter implements EmailProviderAdapter {
  async send(payload: EmailPayload): Promise<{ id: string }> {
    console.log(
      `[email:${payload.template}] to=${payload.to} subject="${payload.subject}"`,
      payload.data ?? {},
    );
    return { id: randomUUID() };
  }
}
