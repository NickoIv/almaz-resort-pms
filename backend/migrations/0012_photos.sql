-- Internal photo documentation: damage, before/after cleaning.
-- Only metadata lives here; the image bytes go to the PHOTOS KV namespace,
-- keyed by storage_key. Keeping blobs out of D1 also keeps them out of the
-- JSON backup, which has a size ceiling.

CREATE TABLE IF NOT EXISTS unit_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id      INTEGER NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  booking_id   INTEGER REFERENCES bookings (id) ON DELETE SET NULL,
  /** Key in the PHOTOS namespace. */
  storage_key  TEXT    NOT NULL UNIQUE,
  content_type TEXT    NOT NULL,
  size_bytes   INTEGER NOT NULL,
  /** 'before' | 'after' | 'damage' | 'other' — what the photo documents. */
  kind         TEXT    NOT NULL DEFAULT 'other',
  caption      TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', '+5 hours')),
  created_by   INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_unit ON unit_photos (unit_id, created_at);
