-- Opaque server-side sessions, not JWT: the cookie holds a random bearer
-- token; only its HMAC-SHA256 hash (via SESSION_SECRET) is ever stored here.
-- That makes a session individually revocable (logout, password reset,
-- "log out everywhere") with a plain DELETE, with no signing-algorithm
-- surface and no key-rotation story to build.
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  ip_address  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
