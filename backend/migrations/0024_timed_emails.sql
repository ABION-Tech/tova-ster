-- Timed emails. Each send is recorded once per (kind, ref) so a job that runs
-- every hour, or twice at once, never sends the same email twice.
CREATE TABLE IF NOT EXISTS email_sends (
  kind     TEXT NOT NULL,
  ref      TEXT NOT NULL,
  email    TEXT NOT NULL,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref)
);
CREATE INDEX IF NOT EXISTS email_sends_email_idx ON email_sends (lower(email), kind, sent_at DESC);
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;

-- "Tell me when it's back": one row per address and product; cleared of the
-- address once the email has gone (only the fact that it was sent is kept).
CREATE TABLE IF NOT EXISTS stock_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_alerts_waiting_uq ON stock_alerts (product_id, lower(email)) WHERE notified_at IS NULL;
ALTER TABLE stock_alerts ENABLE ROW LEVEL SECURITY;
