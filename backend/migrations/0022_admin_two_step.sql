-- Two-step sign-in for the team (authenticator app, TOTP).
-- totp_secret (added in 0012) holds the secret sealed with AES-256-GCM.
ALTER TABLE admin_users
  ADD COLUMN totp_pending     TEXT,          -- sealed secret while setting up, before the first code is confirmed
  ADD COLUMN totp_enabled_at  TIMESTAMPTZ,
  ADD COLUMN totp_last_step   BIGINT;        -- last 30-second step used, so a code can't be used twice

-- After the password, a short-lived ticket waits for the 6-digit code.
CREATE TABLE admin_mfa_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  attempts       INTEGER NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE admin_mfa_tickets ENABLE ROW LEVEL SECURITY;

-- One-time recovery codes for a lost phone (only hashes stored).
CREATE TABLE admin_recovery_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash      TEXT NOT NULL,
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_recovery_codes_user_idx ON admin_recovery_codes (admin_user_id);
ALTER TABLE admin_recovery_codes ENABLE ROW LEVEL SECURITY;
