-- Team page: the Owner invites people by email; each invite is a one-time
-- link to choose a password. Only the hash of the link's token is stored.
CREATE TABLE admin_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_by     UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_invites_user_idx ON admin_invites (admin_user_id);
ALTER TABLE admin_invites ENABLE ROW LEVEL SECURITY;

-- An invited person has no password until they accept.
ALTER TABLE admin_users ALTER COLUMN password_hash DROP NOT NULL;
