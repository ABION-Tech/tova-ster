-- Delivery instructions are specific to one order ("leave with the
-- gateman", "call on arrival"), not a property of a reusable saved
-- address — so this lives on orders, not addresses.
ALTER TABLE orders ADD COLUMN delivery_instructions TEXT;
