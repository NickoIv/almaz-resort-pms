-- Guests turned away because the dates were taken.
-- Deliberately not tied to a specific unit: someone who wanted a room on a
-- weekend will usually take any room, so the entry records the unit *type*
-- plus an optional preferred unit.

CREATE TABLE IF NOT EXISTS waitlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_name  TEXT    NOT NULL,
  guest_phone TEXT,
  unit_type   TEXT    NOT NULL CHECK (unit_type IN ('room', 'sunbed', 'gazebo', 'vip_gazebo')),
  /** The unit they originally asked for, when there was one. */
  unit_id     INTEGER REFERENCES units (id) ON DELETE SET NULL,
  date_from   TEXT    NOT NULL,
  date_to     TEXT    NOT NULL,
  note        TEXT,
  status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'placed', 'closed')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now', '+5 hours')),
  created_by  INTEGER REFERENCES staff_users (id) ON DELETE SET NULL,
  closed_at   TEXT,
  closed_by   INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_open ON waitlist (status, date_from, date_to);
