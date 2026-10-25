-- A cart belongs to exactly one lineage: a logged-in user OR a guest
-- session token, never both, never neither. Stage 3's "associate guest cart
-- to account on login" is done by flipping user_id/guest_token on this same
-- row (and marking any pre-existing active user cart 'converted' first) —
-- not by copying rows — which is what keeps "one profile, one cart lineage"
-- true instead of just documented.
CREATE TABLE carts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_token       TEXT UNIQUE,
  status            cart_status NOT NULL DEFAULT 'active',
  -- Drives Stage 11's 24h abandonment check; bumped on any cart mutation.
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cart_exactly_one_owner CHECK (
    (user_id IS NOT NULL AND guest_token IS NULL) OR
    (user_id IS NULL AND guest_token IS NOT NULL)
  )
);

-- A user (or guest token) can have many historical carts (converted/
-- abandoned/expired) but at most one *active* one — this is the DB-level
-- guarantee behind "never two unrelated active carts from different entry
-- points".
CREATE UNIQUE INDEX carts_one_active_per_user
  ON carts (user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX carts_one_active_per_guest
  ON carts (guest_token) WHERE status = 'active' AND guest_token IS NOT NULL;

CREATE TRIGGER carts_set_updated_at
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id               UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_variant_id    UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  -- Display-only, so the cart page doesn't need a join to show a price.
  -- The PRD is explicit that checkout always recalculates for real —
  -- this column must never be trusted as the charge amount.
  unit_price_snapshot   NUMERIC(12, 2) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cart_items_cart_id_idx ON cart_items (cart_id);

-- One line per (cart, product, variant). product_variant_id is nullable, and
-- NULL <> NULL under a plain UNIQUE constraint, so a sentinel stands in for
-- "no variant" in this expression index — otherwise two "add to cart" calls
-- for the same no-variant product would create two separate rows.
CREATE UNIQUE INDEX cart_items_unique_line ON cart_items (
  cart_id,
  product_id,
  COALESCE(product_variant_id, '00000000-0000-0000-0000-000000000000'::UUID)
);

CREATE TRIGGER cart_items_set_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stage 11 owns the scheduling/sending logic; this table just gives it
-- somewhere durable to record what's scheduled, sent, or cancelled, so a
-- restart of the reminder job never re-sends or loses track of a step.
CREATE TABLE cart_reminders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id       UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  step          cart_reminder_step NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  status        cart_reminder_status NOT NULL DEFAULT 'scheduled',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per step per cart lineage. Stage 11's "recalculate the cycle on
  -- meaningful re-engagement" cancels the stale rows and inserts fresh ones
  -- rather than reusing them, so this stays a hard uniqueness guarantee
  -- against duplicate sends rather than a soft convention.
  CONSTRAINT cart_reminders_unique_step UNIQUE (cart_id, step)
);

CREATE INDEX cart_reminders_cart_id_idx ON cart_reminders (cart_id);
CREATE INDEX cart_reminders_due_idx ON cart_reminders (scheduled_at) WHERE status = 'scheduled';
