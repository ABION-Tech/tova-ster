-- Customers. One row per registered account (Stage 3 owns everything about
-- how these fields get populated/verified — this migration only owns shape).
CREATE TABLE users (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                           TEXT NOT NULL,
  password_hash                   TEXT NOT NULL,
  first_name                      TEXT NOT NULL,
  last_name                       TEXT NOT NULL,
  phone                           TEXT,
  -- Stubbed, not wired, per Stage 3 ("leave Google auth stubbed-but-not-wired").
  google_id                       TEXT UNIQUE,
  email_verified                  BOOLEAN NOT NULL DEFAULT FALSE,
  email_verification_token        TEXT,
  email_verification_expires_at   TIMESTAMPTZ,
  password_reset_token            TEXT,
  password_reset_expires_at       TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without an extra extension (citext):
-- login/registration should treat Foo@x.com and foo@x.com as the same account.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Admin accounts are a deliberately separate table from `users`, per the
-- PRD's "no super-admin layer" — every admin_users row is a full admin.
CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_users_email_lower_idx ON admin_users (lower(email));

CREATE TRIGGER admin_users_set_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Addresses are NOT owned exclusively by users: a guest order still needs a
-- shipping address row to point at, so user_id is nullable. Guest addresses
-- just never get reused across orders; account addresses can be (is_default).
CREATE TABLE addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT,
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  line1       TEXT NOT NULL,
  line2       TEXT,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  country     TEXT NOT NULL DEFAULT 'NG',
  postal_code TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX addresses_user_id_idx ON addresses (user_id);

CREATE TRIGGER addresses_set_updated_at
  BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
