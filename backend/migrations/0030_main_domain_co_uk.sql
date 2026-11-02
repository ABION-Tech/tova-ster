-- tova-ster.co.uk is now the shop's main address (tova-ster.com redirects to it).
-- Updates the web address printed on invoices and emails, if still the old default.
UPDATE site_settings
SET value = jsonb_set(value, '{web}', '"tova-ster.co.uk"'::jsonb)
WHERE key = 'business' AND value->>'web' IN ('tova-ster.com', 'www.tova-ster.com');
