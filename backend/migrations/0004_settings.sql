-- Notification settings: which checks the scheduled Worker reports on.
-- Simple key/value so new toggles need no schema change.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('notify_checkins', '1'),
  ('notify_checkouts', '1'),
  ('notify_cleaning', '1'),
  ('notify_unpaid', '1');