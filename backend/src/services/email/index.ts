import { EmailService } from "./EmailService.js";
import { ResendAdapter } from "./ResendAdapter.js";
import { ConsoleEmailAdapter } from "./ConsoleEmailAdapter.js";

// Single wiring point. Every route imports `emailService` from here — never
// an adapter directly. To swap providers, change one line below.
const adapter =
  process.env.RESEND_API_KEY
    ? new ResendAdapter()
    : new ConsoleEmailAdapter();

if (process.env.NODE_ENV === "production" && !process.env.RESEND_API_KEY) {
  console.warn(
    "[email] WARNING: RESEND_API_KEY is not set — falling back to " +
      "ConsoleEmailAdapter. Transactional emails are only being logged, " +
      "not delivered. Set RESEND_API_KEY + EMAIL_FROM in production.",
  );
}

export const emailService = new EmailService(adapter);
