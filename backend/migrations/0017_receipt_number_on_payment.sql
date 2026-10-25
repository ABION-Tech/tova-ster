-- UK VAT invoices need an unbroken run of numbers. Receipt numbers are now
-- given only when a payment succeeds (from the same sequence), so unpaid or
-- abandoned orders never leave gaps.
ALTER TABLE orders ALTER COLUMN receipt_number DROP DEFAULT, ALTER COLUMN receipt_number DROP NOT NULL;
UPDATE orders SET receipt_number = NULL WHERE status = 'PENDING_PAYMENT';
CREATE UNIQUE INDEX IF NOT EXISTS orders_receipt_number_uniq ON orders (receipt_number) WHERE receipt_number IS NOT NULL;
