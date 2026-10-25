# UK / Tova-ster conversion — Patch 1

**Market:** UK only, GBP, VAT-inclusive prices. **Payments:** Stripe (hosted Checkout).

## What changed
**Payments (backend)**
- `services/payment/StripeAdapter.ts` — new. Creates a Stripe Checkout Session; the payment `reference` is the Checkout Session id. Apple Pay, Google Pay, Link, and any of PayPal / Klarna / Clearpay switched on in the Stripe dashboard appear automatically — no per-method code.
- `services/payment/index.ts` — provider chosen by `PAYMENT_PROVIDER` (default `stripe`). Paystack adapter kept, inactive.
- `routes/payments.ts` — new `POST /webhooks/stripe` (signature + 5-minute timestamp check). Shared handler re-verifies with Stripe, compares amount AND currency with our own order, ignores replays, leaves delayed methods pending, handles `async_payment_failed` and `expired`. Paystack route kept behind the provider flag.
- `amountKobo` renamed `amountMinor` (pence).

**Currency, VAT, delivery, addresses**
- Migration `0011_uk_gbp_stripe_vat.sql`: `stripe` provider enum value, GBP defaults, `addresses.state` optional / country `GB`, `products.vat_rate` (default 20), `orders.vat_total`.
- `services/delivery/index.ts` — UK postcode zones: Mainland, Highlands & Islands, Northern Ireland; Channel Islands / Isle of Man not served. Fees and free-delivery threshold come from env (PLACEHOLDERS: £3.99 / £7.99 / £5.99, free over £40 on mainland).
- `GET /delivery/estimate?postcode=&subtotal=` replaces the state lookup. Orders compute delivery and VAT server-side; postcode required, county optional.
- Emails show £ with 2 decimals.

**Frontend**
- All ₦ formatting is now £ (en-GB, 2 decimals). Checkout asks for postcode (live fee, clear error for unserved postcodes), county optional, "VAT: Included". Saved-address form uses postcode instead of Nigerian states.

## Verified
- Backend and frontend `tsc --noEmit` pass; all 11 migrations apply on Postgres 16 and the seed runs.
- `backend/scripts/uk-payment-test/` integration test against a mock Stripe: 12/12 pass (unsigned webhook rejected; unpaid session stays PENDING_PAYMENT; verified paid becomes PAID; replay is a no-op; wrong amount and wrong currency are not paid; GBP, VAT and provider stored; delivery zones).
  Run: start Postgres + `bash scripts/uk-payment-test/_reset.sh`, start `bash scripts/uk-payment-test/_server.sh`, then `node scripts/uk-payment-test/stripe-flow-test.mjs` (paths assume the test DB on port 5433; edit as needed).
- NOT verified here: `next build` (sandbox cannot reach Google Fonts), a real Stripe account, Apple Pay on a real device.

## Still to do (next patches)
1. Stripe dashboard: create the account, enable payment methods, add webhook `{API_URL}/webhooks/stripe` with the 4 events listed in `backend/.env.example`, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
2. Replace the Nigerian seed data (`db/seed.ts`) with Tova-ster products; add supplement fields (facts, ingredients, directions, warnings, age range, approved claims) and the publish check.
3. Abandoned-cart sender (table and steps exist, no job yet), consent-aware.
4. Brand design, legal pages, cookie consent, admin product form with VAT rate.
5. Refunds from admin via Stripe (adapter needs a refund method) and PARTIALLY_REFUNDED status.
6. Confirm delivery fees, threshold and VAT rates with the client.
