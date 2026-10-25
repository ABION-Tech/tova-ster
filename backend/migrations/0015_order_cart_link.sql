-- The basket stays live until payment succeeds (someone who backs out of the
-- card page keeps their basket); the order remembers which basket to close.
ALTER TABLE orders ADD COLUMN cart_id UUID REFERENCES carts(id) ON DELETE SET NULL;
