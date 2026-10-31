-- Refunds go back through the payment provider (Stripe) and are recorded here,
-- one row per refund, so part refunds add up and the money trail is complete.
CREATE TABLE IF NOT EXISTS refunds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount              NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  provider            TEXT NOT NULL,
  provider_refund_id  TEXT,
  status              TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded', 'pending', 'failed')),
  reason              TEXT,
  restocked           BOOLEAN NOT NULL DEFAULT FALSE,
  points_reversed     INTEGER NOT NULL DEFAULT 0,
  admin_id            UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds (order_id, created_at);
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at     TIMESTAMPTZ;
