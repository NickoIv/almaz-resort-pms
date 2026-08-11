-- Объект, снятый с продажи: ремонт, санобработка, служебная бронь.
--
-- Until now the only way to stop selling a room for three days was to write a
-- fake booking on a guest called «Ремонт». That is not a workaround, it is data
-- corruption with a friendly name: occupancy counts those nights as sold, the
-- guest history grows a phantom, «Начислено по броням» counts it, and the
-- no-show and migration alerts can fire on it. A block is a different kind of
-- fact from a stay and gets its own table.
--
-- Line comments only, never /* */ across a newline: `wrangler d1 migrations
-- apply --remote` splits the file into statements before posting them and a
-- block comment arrives truncated (SQLITE_ERROR 7500). It passes locally.

CREATE TABLE IF NOT EXISTS unit_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  -- Half-open, exactly like a booking: 15→18 is the nights of the 15th, 16th
  -- and 17th, and the object is sellable again on the morning of the 18th.
  -- Three places already agree on this rule and a fourth that did not would
  -- show a night as taken on one screen and free on the next.
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES staff_users(id)
);

-- Every read is "what is blocked on this object in this window".
CREATE INDEX IF NOT EXISTS idx_unit_blocks_unit_dates ON unit_blocks(unit_id, date_from, date_to);
