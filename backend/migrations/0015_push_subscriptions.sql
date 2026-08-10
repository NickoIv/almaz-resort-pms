-- Web Push: per-device subscriptions and a record of what has been delivered.
--
-- Staff are notified individually rather than through one shared chat, so the
-- unit of subscription is a *device*, not a person: the same housekeeper may
-- have the app on a phone and on the reception desktop, and both should ring.
--
-- NOTE — line comments only in this file, no /* */ blocks spanning lines.
-- `wrangler d1 migrations apply --remote` splits the file into statements
-- before sending them and does not carry a block comment across a newline, so
-- the statement arrives truncated and D1 rejects it with "incomplete input".
-- Locally the file is executed whole and passes, so this only ever shows up in
-- the deploy. It cost two red pipelines on 2026-08-10.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_user_id INTEGER NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  -- The URL the push service gave this browser install. Unique across the
  -- whole table on purpose: an endpoint identifies one browser, so when a
  -- second member of staff signs in on a shared device and subscribes, the row
  -- must move to them rather than leave the previous person receiving the
  -- notifications meant for that device.
  endpoint      TEXT    NOT NULL UNIQUE,
  -- Subscription public key and auth secret, base64url, from the browser.
  p256dh        TEXT    NOT NULL,
  auth          TEXT    NOT NULL,
  -- Only so a person can recognise which device a row is, when unsubscribing.
  user_agent    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now', '+5 hours')),
  last_ok_at    TEXT,
  -- Consecutive send failures. A push service answers 404 or 410 once a
  -- subscription is dead, and those rows are deleted outright; this counts the
  -- softer failures so a permanently broken endpoint can be recognised without
  -- losing the row to a passing outage.
  failures      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_subs_staff ON push_subscriptions (staff_user_id);

-- What each person has already been pushed.
--
-- Alert ids are stable and encode what makes an event new (see lib/alerts), so
-- "have I sent this" is a primary-key lookup. Without it the five-minute sweep
-- would re-send every outstanding alert twelve times an hour.
CREATE TABLE IF NOT EXISTS push_deliveries (
  staff_user_id INTEGER NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  alert_id      TEXT    NOT NULL,
  sent_at       TEXT    NOT NULL DEFAULT (datetime('now', '+5 hours')),
  PRIMARY KEY (staff_user_id, alert_id)
) WITHOUT ROWID;

-- Rows are pruned by age on the sweep; the index keeps that from scanning.
CREATE INDEX IF NOT EXISTS idx_push_deliveries_sent ON push_deliveries (sent_at);
