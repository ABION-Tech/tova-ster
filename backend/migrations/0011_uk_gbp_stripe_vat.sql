-- UK launch (Tova-ster): Stripe provider, GBP default, UK addresses, VAT-inclusive pricing.

-- New provider value (not used elsewhere in this migration, so safe inside the runner's transaction).
ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'stripe';

-- GBP is the default currency for new orders and payments.
ALTER TABLE orders   ALTER COLUMN currency SET DEFAULT 'GBP';
ALTER TABLE payments ALTER COLUMN currency SET DEFAULT 'GBP';

-- UK addresses: postcode is the key field, county is optional, country is GB.
ALTER TABLE addresses ALTER COLUMN state DROP NOT NULL;
ALTER TABLE addresses ALTER COLUMN country SET DEFAULT 'GB';

-- VAT: shop prices are VAT-inclusive. Per-product rate (percent; 20 = standard, 0 = zero-rated).
-- CONFIRM per product with the client's accountant before launch.
ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20.00;

-- The VAT-included portion of each order, stored at purchase time for invoices and reporting.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_total NUMERIC(12,2) NOT NULL DEFAULT 0;
