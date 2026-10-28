-- One-click unsubscribe: when someone unsubscribes from marketing emails using
-- the link in an email, record it on their account too, so the birthday email
-- (which goes to account holders) stops as well. Signing up again clears it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

-- Sales funnel report: when a basket first had something in it. Baskets are
-- emptied after checkout, so "has items now" can't be used to count them.
ALTER TABLE carts ADD COLUMN IF NOT EXISTS first_item_at TIMESTAMPTZ;
UPDATE carts c SET first_item_at = c.created_at
 WHERE first_item_at IS NULL AND (c.status <> 'active' OR EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_id = c.id));
CREATE INDEX IF NOT EXISTS carts_first_item_idx ON carts (first_item_at) WHERE first_item_at IS NOT NULL;

CREATE OR REPLACE FUNCTION carts_mark_first_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE carts SET first_item_at = now() WHERE id = NEW.cart_id AND first_item_at IS NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cart_items_first_item ON cart_items;
CREATE TRIGGER cart_items_first_item AFTER INSERT ON cart_items FOR EACH ROW EXECUTE FUNCTION carts_mark_first_item();
