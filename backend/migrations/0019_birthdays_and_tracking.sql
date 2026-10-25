-- Birthdays: day and month only (no year), so we can send a birthday treat
-- without storing anyone's age. Optional; customers add or remove it any time.
ALTER TABLE users
  ADD COLUMN birthday_day   SMALLINT CHECK (birthday_day BETWEEN 1 AND 31),
  ADD COLUMN birthday_month SMALLINT CHECK (birthday_month BETWEEN 1 AND 12),
  ADD COLUMN birthday_treat_year SMALLINT,          -- last year the treat was given (once a year)
  ADD CONSTRAINT users_birthday_pair CHECK ((birthday_day IS NULL) = (birthday_month IS NULL));
CREATE INDEX users_birthday_idx ON users (birthday_month, birthday_day) WHERE birthday_month IS NOT NULL;

-- When each order was sent and delivered (tracking number and carrier already exist).
ALTER TABLE orders
  ADD COLUMN dispatched_at TIMESTAMPTZ,
  ADD COLUMN delivered_at  TIMESTAMPTZ;

-- Where a buyer came from (first visit's source), kept on the order for sales-by-channel reports.
ALTER TABLE orders ADD COLUMN source JSONB;
