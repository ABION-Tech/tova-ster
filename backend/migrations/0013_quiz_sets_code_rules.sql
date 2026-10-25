-- A quiz result is sold as a set: one bundle row per set, kind = 'quiz',
-- priced with the quiz discount from settings and hidden from the offers page.
ALTER TABLE bundles
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'quiz'));

-- WELCOME-style codes: only for an email with no earlier paid order.
ALTER TABLE discount_codes
  ADD COLUMN first_order_only BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE discount_codes SET first_order_only = TRUE WHERE code = 'WELCOME10';
