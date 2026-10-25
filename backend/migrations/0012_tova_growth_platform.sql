-- Tova-Ster growth platform: settings and homepage content, richer supplement
-- product data, offers (bundles, codes), subscriptions, reward points,
-- fulfilment/dispatch, customer profiles, staff roles, media and an activity log.

-- ── Settings and content ────────────────────────────────────────────────
-- One row per settings group (features, site, quiz, business, emails, dispatch).
-- JSONB so the admin can add fields without a migration; the API validates shape.
CREATE TABLE site_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Products: supplement details ─────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN short_description TEXT,
  ADD COLUMN pack_size        TEXT,
  ADD COLUMN format           TEXT NOT NULL DEFAULT 'Capsules',
  ADD COLUMN servings         INTEGER NOT NULL DEFAULT 30 CHECK (servings > 0),
  ADD COLUMN needs            TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN audiences        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN badge            TEXT,
  ADD COLUMN benefits         JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN how_to_take      TEXT,
  ADD COLUMN ingredients      TEXT,
  ADD COLUMN facts            JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN warnings         TEXT,
  ADD COLUMN claims_approved  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN video_url        TEXT,
  ADD COLUMN sort_order       INTEGER NOT NULL DEFAULT 0;

-- ── Offers ───────────────────────────────────────────────────────────────
CREATE TABLE bundles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  blurb        TEXT,
  product_ids  UUID[] NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (discount_pct >= 0 AND discount_pct <= 90),
  active       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER bundles_set_updated_at BEFORE UPDATE ON bundles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE discount_codes (
  code        TEXT PRIMARY KEY CHECK (code = upper(code)),
  pct         NUMERIC(5,2) NOT NULL CHECK (pct > 0 AND pct <= 90),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  uses        INTEGER NOT NULL DEFAULT 0,
  max_uses    INTEGER,
  note        TEXT,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Cart: lines can be part of a bundle or a subscription ────────────────
ALTER TABLE carts
  ADD COLUMN discount_code  TEXT,
  ADD COLUMN redeem_points  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE cart_items
  ADD COLUMN bundle_id           UUID REFERENCES bundles(id) ON DELETE CASCADE,
  ADD COLUMN subscription_months INTEGER CHECK (subscription_months IS NULL OR subscription_months BETWEEN 1 AND 12);

DROP INDEX cart_items_unique_line;
CREATE UNIQUE INDEX cart_items_unique_line ON cart_items (
  cart_id,
  product_id,
  COALESCE(product_variant_id, '00000000-0000-0000-0000-000000000000'::UUID),
  COALESCE(bundle_id, '00000000-0000-0000-0000-000000000000'::UUID),
  COALESCE(subscription_months, 0)
);

-- ── Orders: discounts breakdown, points, fulfilment ──────────────────────
ALTER TABLE orders
  ADD COLUMN discounts          JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN points_earned      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN points_used        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN discount_code      TEXT,
  ADD COLUMN payment_method     TEXT,
  ADD COLUMN fulfilment_stage   TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (fulfilment_stage IN ('awaiting_payment', 'held', 'paid', 'label', 'packed', 'dispatched', 'delivered', 'cancelled')),
  ADD COLUMN carrier            TEXT,
  ADD COLUMN tracking_number    TEXT,
  ADD COLUMN fulfilment_events  JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN has_subscription   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN receipt_number     BIGSERIAL;

CREATE INDEX orders_fulfilment_stage_idx ON orders (fulfilment_stage);

ALTER TABLE order_items
  ADD COLUMN bundle_id           UUID,
  ADD COLUMN bundle_name         TEXT,
  ADD COLUMN subscription_months INTEGER,
  ADD COLUMN full_unit_price     NUMERIC(12, 2);

-- ── Customers: consent, points, profile ──────────────────────────────────
ALTER TABLE users
  ADD COLUMN marketing_email  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN marketing_sms    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN points_balance   INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  ADD COLUMN acquisition_source TEXT,
  ADD COLUMN tags             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN erased_at        TIMESTAMPTZ,
  ADD COLUMN stripe_customer_id TEXT;

-- Append-only, like the inventory ledger: the balance on users is a cache,
-- this table is the history that explains it.
CREATE TABLE points_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX points_ledger_user_idx ON points_ledger (user_id, created_at DESC);

CREATE TABLE customer_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_notes_user_idx ON customer_notes (user_id, created_at DESC);

-- ── Subscriptions (Subscribe & Save) ─────────────────────────────────────
CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  email                   TEXT NOT NULL,
  product_id              UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name            TEXT NOT NULL,
  quantity                INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  interval_months         INTEGER NOT NULL CHECK (interval_months BETWEEN 1 AND 12),
  unit_price              NUMERIC(12, 2) NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'past_due')),
  next_charge_at          TIMESTAMPTZ NOT NULL,
  stripe_subscription_id  TEXT UNIQUE,
  source_order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id);
CREATE INDEX subscriptions_due_idx ON subscriptions (next_charge_at) WHERE status = 'active';
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Staff roles and two-step sign-in ─────────────────────────────────────
ALTER TABLE admin_users
  ADD COLUMN role        TEXT NOT NULL DEFAULT 'Owner' CHECK (role IN ('Owner', 'Manager', 'Support', 'Packer')),
  ADD COLUMN totp_secret TEXT,
  ADD COLUMN active      BOOLEAN NOT NULL DEFAULT TRUE;

-- ── Media library (Cloudinary URLs) ──────────────────────────────────────
CREATE TABLE media_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url         TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Activity log: shop events and admin changes ──────────────────────────
-- Shop events only include people who accepted analytics cookies (the
-- storefront checks consent before sending). Admin changes are always kept.
CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_id    UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  session_id  TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_created_idx ON events (created_at DESC);
CREATE INDEX events_type_idx ON events (type, created_at DESC);
CREATE INDEX events_user_idx ON events (user_id, created_at DESC);

-- ── Newsletter (people without accounts) ─────────────────────────────────
CREATE TABLE newsletter_subscribers (
  email       TEXT PRIMARY KEY,
  consent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT,
  unsubscribed_at TIMESTAMPTZ
);
