-- Extensions used across the schema.
-- pgcrypto gives us gen_random_uuid() for UUID primary keys, without
-- pulling in a heavier extension. It's available on every mainstream
-- managed Postgres (Railway, Render, RDS, Neon, self-hosted apt package),
-- which matters since this app must be able to move hosts without
-- redesigning the data layer.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared trigger function: every table with an `updated_at` column uses
-- this instead of hand-rolling app-side timestamp updates, so it's
-- impossible for a forgotten UPDATE to leave a stale updated_at.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
