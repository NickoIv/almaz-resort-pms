-- Why a booking was cancelled. Kept on the booking rather than only in
-- audit_log so the unit detail view can show it without a log lookup.

ALTER TABLE bookings ADD COLUMN cancel_reason TEXT;
ALTER TABLE bookings ADD COLUMN cancel_note TEXT;
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
