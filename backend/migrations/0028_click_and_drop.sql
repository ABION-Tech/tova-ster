-- Royal Mail Click & Drop: each paid order is sent across once; its Click &
-- Drop id is kept so the label's tracking number and dispatch can come back.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier_order_id  TEXT,
  ADD COLUMN IF NOT EXISTS carrier_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_error     TEXT;
CREATE INDEX IF NOT EXISTS orders_carrier_open_idx ON orders (carrier_order_id) WHERE carrier_order_id IS NOT NULL AND status IN ('PAID','PROCESSING');
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_grams INTEGER CHECK (weight_grams IS NULL OR weight_grams > 0);
