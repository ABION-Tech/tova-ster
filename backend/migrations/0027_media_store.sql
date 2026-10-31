-- Photos uploaded in the admin, kept in the database when no image service
-- (Cloudinary) is set up. Served at /media/<id> with long browser caching.
CREATE TABLE IF NOT EXISTS media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type  TEXT NOT NULL,
  bytes         BYTEA NOT NULL,
  size          INTEGER NOT NULL,
  folder        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
