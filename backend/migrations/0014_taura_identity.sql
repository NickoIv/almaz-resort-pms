-- The business is "Taura", ул. Алма-Арасан, 4а, Алматы. "Almaz Resort" was a
-- placeholder carried since the first prompt, and it reaches guests: it is the
-- name printed at the top of every check-out receipt and act.
--
-- Migration 0010 seeded these rows, so the code defaults in
-- backend/src/lib/notifications.ts only apply to a database that never ran it.
-- The rows themselves have to be updated, which is what this does.
--
-- Each UPDATE is guarded on the value it is replacing. Settings are editable
-- in the UI, and a migration that ran after someone had typed the real details
-- in by hand would silently overwrite their work. Guarded this way it is also
-- safe to re-run.

UPDATE settings SET value = 'Taura'
 WHERE key = 'hotel_name' AND value = 'Almaz Resort';

UPDATE settings SET value = 'ул. Алма-Арасан, 4а, Алматы'
 WHERE key = 'hotel_details' AND value = '';

UPDATE settings SET value = 'https://2gis.kz/almaty/geo/9429940001542859/76.908229,43.126376'
 WHERE key = 'reviews_2gis_url' AND value = '';
