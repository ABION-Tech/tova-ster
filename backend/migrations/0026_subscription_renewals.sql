-- Automatic Subscribe & Save renewals. The first order saves the card with the
-- payment provider (Stripe keeps it; we keep only its ids), and each cycle the
-- renewal job charges it and creates a normal order for packing.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider_customer_id  TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_id     TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_id   UUID REFERENCES addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failed_attempts       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_renewed_at       TIMESTAMPTZ;

-- One renewal order per subscription group and due date, however often the job runs.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS renewal_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_renewal_key_uq ON orders (renewal_key) WHERE renewal_key IS NOT NULL;

-- Fill in the delivery address for subscriptions started before this change.
UPDATE subscriptions s SET shipping_address_id = o.shipping_address_id
  FROM orders o WHERE o.id = s.source_order_id AND s.shipping_address_id IS NULL;
