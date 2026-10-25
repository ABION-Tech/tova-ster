-- "Remember me" without an account: the basket remembers the postcode it was
-- quoted for (so delivery shows the real zone next visit) and the email typed
-- at checkout (so an abandoned basket can be emailed, with consent).
ALTER TABLE carts
  ADD COLUMN postcode TEXT,
  ADD COLUMN email    TEXT;

-- Signed-in shoppers: quiz result, recently viewed and similar small state
-- follow them across devices. Guests keep the same shape in the browser.
ALTER TABLE users
  ADD COLUMN saved_state JSONB NOT NULL DEFAULT '{}'::JSONB;
