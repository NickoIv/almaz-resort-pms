-- Миграционный учёт иностранных гостей.
--
-- Line comments only — wrangler splits this file into statements before posting
-- them to the D1 API and does not carry a block comment across a line break.
--
-- Kazakhstan puts the duty to notify on the receiving party: a hotel has three
-- days from a foreign guest's arrival to tell the migration service, through
-- eQonaq or the visa-migration portal, and there is a fine for missing it. The
-- notice needs the name, the citizenship, the passport number, the address of
-- stay and the dates — the app already holds the name, the dates and the
-- address; the two it never asked for are here.
--
-- Nothing is required. A booking with no citizenship recorded is simply not
-- counted as foreign, so the hotel can start filling this in when it chooses
-- and nothing changes until then.
ALTER TABLE bookings ADD COLUMN guest_citizenship TEXT;

-- Passport or ID number, exactly as it will be typed into the notice.
ALTER TABLE bookings ADD COLUMN guest_document TEXT;

-- When the hotel actually filed the notice, and who marked it filed. The app
-- cannot submit on anyone's behalf — that needs the receiving party's ЭЦП — so
-- this records the human act rather than pretending to perform it.
ALTER TABLE bookings ADD COLUMN migration_notified_at TEXT;
ALTER TABLE bookings ADD COLUMN migration_notified_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL;

-- The list is read by "who still has to be filed", so the outstanding ones are
-- what the index is for.
CREATE INDEX idx_bookings_migration ON bookings (migration_notified_at, guest_citizenship);
