-- Resort PMS — initial schema
-- Hotel (14 rooms) + restaurant recreation area (sunbeds, gazebos, VIP gazebos)

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS cleaning_checklist;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS staff_users;
DROP TABLE IF EXISTS units;

CREATE TABLE units (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT    NOT NULL CHECK (type IN ('room', 'sunbed', 'gazebo', 'vip_gazebo')),
  name      TEXT    NOT NULL,
  category  TEXT,
  capacity  INTEGER NOT NULL DEFAULT 2
);

CREATE UNIQUE INDEX idx_units_type_name ON units (type, name);

CREATE TABLE bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id        INTEGER NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  guest_name     TEXT    NOT NULL,
  guest_phone    TEXT,
  date_from      TEXT    NOT NULL,
  date_to        TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'booked' CHECK (status IN ('free', 'booked', 'occupied')),
  total_amount   REAL    NOT NULL DEFAULT 0,
  prepaid_amount REAL    NOT NULL DEFAULT 0,
  deposit_amount REAL    NOT NULL DEFAULT 0,
  currency       TEXT    NOT NULL DEFAULT 'KZT',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bookings_unit  ON bookings (unit_id);
CREATE INDEX idx_bookings_dates ON bookings (date_from, date_to);

CREATE TABLE cleaning_checklist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id    INTEGER NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings (id) ON DELETE SET NULL,
  item_name  TEXT    NOT NULL,
  is_done    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  updated_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX idx_cleaning_unit    ON cleaning_checklist (unit_id);
CREATE INDEX idx_cleaning_booking ON cleaning_checklist (booking_id);

CREATE TABLE staff_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  phone         TEXT    NOT NULL UNIQUE,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'housekeeper', 'waiter')),
  pin_code_hash TEXT    NOT NULL
);

CREATE TABLE payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  amount     REAL    NOT NULL,
  method     TEXT    NOT NULL DEFAULT 'cash',
  paid_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_payments_booking ON payments (booking_id);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_user_id INTEGER REFERENCES staff_users (id) ON DELETE SET NULL,
  action        TEXT    NOT NULL,
  entity        TEXT    NOT NULL,
  entity_id     INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_created ON audit_log (created_at);