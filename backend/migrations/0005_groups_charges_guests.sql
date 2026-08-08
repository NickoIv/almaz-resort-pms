-- Group bookings, extra charges and guest notes.

-- One event / company booking several units at once.
CREATE TABLE IF NOT EXISTS booking_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  guest_name  TEXT NOT NULL,
  guest_phone TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);

-- Each unit in a group still gets its own booking row, so availability,
-- calendars and cleaning keep working unchanged; the group only ties them.
ALTER TABLE bookings ADD COLUMN group_id INTEGER REFERENCES booking_groups (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_group ON bookings (group_id);

-- A combined group payment is stored as one row per booking sharing a group_id,
-- so `payments` stays per-booking (analytics joins through to a unit type) while
-- the UI can still present the instalment as a single entry.
ALTER TABLE payments ADD COLUMN group_id INTEGER REFERENCES booking_groups (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_group ON payments (group_id);

-- Penalties and extras: damage, late checkout, minibar. Kept out of
-- bookings.total_amount so the room rate stays reportable on its own.
CREATE TABLE IF NOT EXISTS charges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  reason     TEXT    NOT NULL,
  amount     REAL    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_charges_booking ON charges (booking_id);

-- Free-text preferences / warnings, keyed by phone since that is what
-- identifies a returning guest across bookings.
CREATE TABLE IF NOT EXISTS guest_notes (
  phone      TEXT PRIMARY KEY,
  notes      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);