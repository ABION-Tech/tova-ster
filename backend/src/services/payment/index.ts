import { PaymentService, type PaymentProviderAdapter } from "./PaymentService.js";
import { StripeAdapter } from "./StripeAdapter.js";
import { PaystackAdapter } from "./PaystackAdapter.js";
import { TestPayAdapter } from "./TestPayAdapter.js";

// Single wiring point, same pattern as services/email and services/storage.
// Every route imports `paymentService` from here — never the adapter or any
// provider SDK directly. UK launch provider: Stripe (set PAYMENT_PROVIDER to
// switch; no business logic changes).
export const paymentProvider = (process.env.PAYMENT_PROVIDER ?? "stripe") as "stripe" | "paystack" | "test";

const adapter: PaymentProviderAdapter =
  paymentProvider === "paystack" ? new PaystackAdapter()
  : paymentProvider === "test" ? new TestPayAdapter() // local/staging only, refuses production
  : new StripeAdapter();

export const paymentService = new PaymentService(adapter);
