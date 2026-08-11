-- Возврат депозита.
--
-- `deposit_amount` has been stored and shown as «возвратный, не входит в
-- остаток» since the beginning, and nothing ever recorded that it was given
-- back. So at the end of a shift nobody could answer «вернули ли залог 5 000?»
-- — the figure just sat on the booking for ever, which is the one thing a
-- refundable hold must never do.
--
-- Line comments only, never /* */ across a newline: `wrangler d1 migrations
-- apply --remote` splits the file into statements before posting them and a
-- block comment arrives truncated (SQLITE_ERROR 7500). It passes locally.

-- How much came back. NULL means nobody has returned it yet — deliberately not
-- 0, which is a real and different answer: the whole hold was withheld.
ALTER TABLE bookings ADD COLUMN deposit_returned REAL;

ALTER TABLE bookings ADD COLUMN deposit_returned_at TEXT;
ALTER TABLE bookings ADD COLUMN deposit_returned_by INTEGER REFERENCES staff_users(id);

-- Why anything was kept back. Required whenever the guest gets less than they
-- left, because «удержано 5 000» with no reason is the start of an argument
-- nobody can settle a week later.
ALTER TABLE bookings ADD COLUMN deposit_note TEXT;
