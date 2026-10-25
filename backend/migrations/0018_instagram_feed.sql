-- Instagram feed: one connected account (token encrypted by the app) and a
-- cached copy of its posts, refreshed by the server every 30 minutes so the
-- shop never waits on Instagram and keeps working if Instagram is down.
CREATE TABLE instagram_connection (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token_enc TEXT,
  ig_user_id       TEXT,
  username         TEXT,
  token_expires_at TIMESTAMPTZ,
  last_sync_at     TIMESTAMPTZ,
  last_error       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE instagram_media (
  id            TEXT PRIMARY KEY,
  media_type    TEXT NOT NULL,              -- IMAGE, VIDEO, CAROUSEL_ALBUM
  media_url     TEXT,                       -- can be missing for some reels (licensed audio)
  thumbnail_url TEXT,
  permalink     TEXT NOT NULL,
  caption       TEXT,
  posted_at     TIMESTAMPTZ NOT NULL,
  children      JSONB NOT NULL DEFAULT '[]'::JSONB,
  hidden        BOOLEAN NOT NULL DEFAULT FALSE, -- admin can hide a post from the shop
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX instagram_media_posted_idx ON instagram_media (posted_at DESC);
