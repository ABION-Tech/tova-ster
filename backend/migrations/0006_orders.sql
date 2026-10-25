-- An order belongs to a user OR is a guest order identified by email —
-- never neither, since Stage 10's transactional emails and Stage 9's admin
-- order view both need someone to reach. order_number is the human-facing
-- id shown to the customer/admin; `id` (UUID) is the internal FK target.
CREATE TABLE orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number         TEXT NOT NULL UNIQUE,
  user_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_email          TEXT,
  guest_phone          TEXT,
  status               order_status NOT NULL DEFAULT 'PENDING_PAYMENT',
  currency             CHAR(3) NOT NULL DEFAULT 'NGN',
  -- Every amount here is server-computed at checkout, never taken from the
  -- cart as-is (PRD §0: "backend recalculates price/stock/total at checkout
  -- regardless of what the cart says").
  subtotal             NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee         NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  discount_total       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  total                NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  shipping_address_id  UUID REFERENCES addresses(id) ON DELETE SET NULL,
  billing_address_id   UUID REFERENCES addresses(id) ON DELETE SET NULL,
  placed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_has_a_contact CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);

CREATE INDEX orders_user_id_idx ON orders (user_id);
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_placed_at_idx ON orders (placed_at DESC);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Line items snapshot product name/price/variant attributes at time of
-- purchase, deliberately duplicating data that also lives on
-- products/product_variants — so a later price change or product edit
-- never rewrites history on a past order. FKs are ON DELETE SET NULL for
-- the same reason: the order record must survive the product being deleted.
CREATE TABLE order_items (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id                  UUID REFERENCES products(id) ON DELETE SET NULL,
  product_variant_id          UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot       TEXT NOT NULL,
  variant_attributes_snapshot JSONB,
  unit_price                  NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  quantity                    INTEGER NOT NULL CHECK (quantity > 0),
  line_total                  NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);

-- One row per attempted payment against an order (a retry after a failed
-- attempt is a new row, not an update). The unique (provider,
-- provider_reference) pair is the actual duplicate-webhook guard named in
-- Stage 8's exit condition: a replayed webhook for a reference we've already
-- recorded hits this constraint instead of double-processing the order.
CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider           payment_provider NOT NULL,
  provider_reference TEXT NOT NULL,
  status             payment_status NOT NULL DEFAULT 'initiated',
  amount             NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency           CHAR(3) NOT NULL DEFAULT 'NGN',
  -- Full webhook body, kept for dispute/audit trail — never parsed for
  -- business logic outside PaymentService itself.
  raw_payload        JSONB,
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payments_provider_reference_unique UNIQUE (provider, provider_reference)
);

CREATE INDEX payments_order_id_idx ON payments (order_id);
CREATE INDEX payments_status_idx ON payments (status);

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
