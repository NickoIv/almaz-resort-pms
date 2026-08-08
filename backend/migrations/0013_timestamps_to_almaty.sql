-- Timestamps were being written with datetime('now') — UTC — while every date
-- comparison in the app uses Almaty (UTC+5). A payment taken at 22:00 Almaty
-- was therefore stamped with the previous day and fell outside "today" in
-- analytics, the accountant act and the weekday breakdown. Five hours of every
-- evening landed on the wrong day.
--
-- The code now passes Almaty wall-clock explicitly on every insert. This
-- migration shifts the rows already written, so history lines up with it.
-- Each row moves by exactly the offset it was short: the instant is unchanged,
-- only its written representation.
--
-- Runs once, by definition of a migration — applying the shift twice would
-- push everything five hours into the future.

UPDATE bookings           SET created_at = datetime(created_at, '+5 hours');
UPDATE payments           SET paid_at    = datetime(paid_at,    '+5 hours');
UPDATE audit_log          SET created_at = datetime(created_at, '+5 hours');
UPDATE charges            SET created_at = datetime(created_at, '+5 hours');
UPDATE booking_groups     SET created_at = datetime(created_at, '+5 hours');
UPDATE guest_notes        SET updated_at = datetime(updated_at, '+5 hours');
UPDATE settings           SET updated_at = datetime(updated_at, '+5 hours') WHERE updated_at IS NOT NULL;
UPDATE cleaning_checklist SET updated_at = datetime(updated_at, '+5 hours') WHERE updated_at IS NOT NULL;

-- Note: the DEFAULT clauses on these columns still read datetime('now').
-- SQLite cannot alter a default without rebuilding the table, and rebuilding
-- six tables to change a fallback that the code no longer relies on is not a
-- trade worth making. Every insert now supplies the value explicitly.
