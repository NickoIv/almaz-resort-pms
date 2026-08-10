-- Who read the booking back, and when.
--
-- A booking is typed while the guest is on the phone: room, dates, price and
-- prepayment all entered in one pass, and a wrong digit in any of them is only
-- discovered on the day the guest arrives. The app now shows the finished
-- booking back as a summary and asks for one deliberate press before it closes.
--
-- The press is worth recording rather than merely worth requiring. "Nobody
-- checked this one" and "someone checked it and it was still wrong" are
-- different problems with different fixes, and without these two columns the
-- database cannot tell them apart.
--
--   verified_at  Almaty wall-clock time of the press, like every other stamp
--   verified_by  who pressed it, which need not be who created the booking
--
-- Null on every existing row, and that stays null: those bookings were never
-- shown to anyone for checking, and back-filling them with the creator would
-- claim a check that never happened.
--
-- ON DELETE SET NULL, as with payments.received_by — the record of the check
-- outlives the person leaving.
--
-- NOTE — line comments only, no /* */ across a newline. See 0015 for why.

ALTER TABLE bookings ADD COLUMN verified_at TEXT;
ALTER TABLE bookings ADD COLUMN verified_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL;

-- The question this answers is "what has nobody checked", so the index is on
-- the stamp and covers the null rows the query is looking for.
CREATE INDEX IF NOT EXISTS idx_bookings_verified_at ON bookings (verified_at);