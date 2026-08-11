-- Переселение брони в другой номер.
--
-- A guest who moves rooms mid-stay leaves two rows: the nights already slept in
-- the old unit, and the continuation in the new one. These two columns are what
-- keeps that readable as ONE arrival instead of two unrelated bookings.
--
-- Line comments only, never /* */ across a newline: `wrangler d1 migrations
-- apply --remote` splits the file into statements before posting them and a
-- block comment arrives truncated (SQLITE_ERROR 7500). It passes locally.

-- Which booking this one continues. NULL on every ordinary booking, and on the
-- first leg of a move.
ALTER TABLE bookings ADD COLUMN moved_from_booking_id INTEGER REFERENCES bookings(id);

-- The day the guest arrived at the hotel, when that is not the day this row
-- starts. Миграционный учёт counts three days from arrival, and it reads
-- `date_from` — so without this a move on day two would silently hand the hotel
-- three fresh days and a fine at the end of them. NULL means "same as
-- date_from", which is every booking nobody has moved.
ALTER TABLE bookings ADD COLUMN arrived_on TEXT;

-- Both legs of a move are looked up by the leg they continue.
CREATE INDEX IF NOT EXISTS idx_bookings_moved_from ON bookings(moved_from_booking_id);
