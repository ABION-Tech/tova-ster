-- Test checkout (PAYMENT_PROVIDER=test, local/staging only) records its
-- payments honestly as 'test' rather than pretending to be Stripe.
ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'test';
