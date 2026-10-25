-- Low-stock visibility at the data layer (Stage 4 requirement; Stage 9's
-- dashboard just queries against this later). A per-product/variant
-- threshold rather than one global number, since a supplement restocked
-- weekly and a drink restocked daily don't share a sensible cutoff.
ALTER TABLE products
  ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0);

ALTER TABLE product_variants
  ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0);

-- Admin sessions are a separate table from customer `sessions`, mirroring
-- the users/admin_users split from migration 0003 — an admin login must
-- never be checkable against, or confusable with, a customer session.
CREATE TABLE admin_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  user_agent    TEXT,
  ip_address    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_sessions_admin_user_id_idx ON admin_sessions (admin_user_id);
CREATE INDEX admin_sessions_expires_at_idx ON admin_sessions (expires_at);
