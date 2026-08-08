-- Free-text settings an admin can edit: the name printed on receipts, and
-- (used from §10) links to the public review profiles.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('hotel_name', 'Almaz Resort'),
  ('hotel_details', ''),
  ('reviews_2gis_url', ''),
  ('reviews_google_url', '');
