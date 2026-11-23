-- Subscribe & Save off unless the team switches it on in Growth. The shop
-- already hides every subscribe option, price and announcement line while it
-- is off, so the "Subscribe & save 15% on every order" line disappears too and
-- comes back on its own when the feature is switched on.
UPDATE site_settings
SET value = jsonb_set(value, '{subscribe,on}', 'false'::jsonb)
WHERE key = 'features' AND value ? 'subscribe';
