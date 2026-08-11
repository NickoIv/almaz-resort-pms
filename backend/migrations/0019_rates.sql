-- Прайс-лист: цена за ночь по типу и категории объекта.
--
-- Line comments only, never a block comment spanning a newline: wrangler
-- splits this file into statements before posting them to the D1 API and does
-- not carry `/* */` across a line break, so the statement arrives truncated.
--
-- Nothing here is required. With the table empty every quote comes back null
-- and the booking form behaves exactly as it did — the price is typed by hand.
-- That is deliberate: the hotel fills this in when it is ready, not before.
CREATE TABLE rates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_type     TEXT    NOT NULL CHECK (unit_type IN ('room', 'sunbed', 'gazebo', 'vip_gazebo')),
  -- NULL means "any category of this type" — the fallback when no row names
  -- the guest's exact category.
  category      TEXT,
  -- Sunday to Thursday nights.
  weekday_price REAL    NOT NULL DEFAULT 0,
  -- Friday and Saturday nights. A hotel an hour outside Almaty fills at the
  -- weekend, which is the whole reason two prices exist rather than one.
  weekend_price REAL    NOT NULL DEFAULT 0,
  -- A season is the same row with a date range. Both bounds inclusive, both
  -- NULL for the base price that applies whenever no season covers the night.
  season_name   TEXT,
  season_from   TEXT,
  season_to     TEXT,
  updated_at    TEXT,
  updated_by    INTEGER REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX idx_rates_lookup ON rates (unit_type, category);
