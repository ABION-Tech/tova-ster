-- Free delivery off unless the team switches it on (it costs the postage on
-- every order over the threshold). Removes the "Free UK delivery…" line from
-- the announcement bar, and adds the editable delivery area names.
UPDATE site_settings
SET value = jsonb_set(value, '{freeDelivery,on}', 'false'::jsonb)
WHERE key = 'features' AND value ? 'freeDelivery';

UPDATE site_settings
SET value = jsonb_set(value, '{announcement,messages}', COALESCE((
      SELECT jsonb_agg(m) FROM jsonb_array_elements(value->'announcement'->'messages') AS m
      WHERE NOT (m::text ILIKE '%free%deliver%' OR m::text ILIKE '%free%shipping%')
    ), '[]'::jsonb) || '["Delivered across the UK"]'::jsonb)
WHERE key = 'features' AND value ? 'announcement'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(value->'announcement'->'messages') AS m WHERE m::text ILIKE '%free%deliver%' OR m::text ILIKE '%free%shipping%');
