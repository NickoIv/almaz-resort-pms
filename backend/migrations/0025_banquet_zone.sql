-- Костровая зона: беседки, топчаны и сцена, сдаваемые целиком под событие.
--
-- Новый тип объекта, а не «ещё одна беседка». Продаётся он иначе: не за место и
-- не за час, а за человека по банкетному меню, и на время события никого
-- постороннего внутри быть не должно.
--
-- ── Почему эта миграция такая длинная ──────────────────────────────────────
--
-- Тип объекта закрыт CHECK-ограничением, а менять CHECK SQLite не умеет: таблицу
-- надо пересобрать. И вот здесь стоит ловушка, которая едва не стоила гостинице
-- всей истории.
--
-- `DROP TABLE units` при включённых внешних ключах ведёт себя как удаление всех
-- строк. `bookings.unit_id` объявлен `ON DELETE CASCADE`, а за бронями по той же
-- цепочке идут `payments` и `charges`; отдельно каскадом висят
-- `cleaning_checklist` и `unit_photos`. Первый вариант этой миграции опирался на
-- `PRAGMA defer_foreign_keys` — и на копии прода дал 13 броней до и **0** после:
-- откладывается проверка ограничений, но не каскады. `PRAGMA foreign_keys = OFF`
-- тоже не спасает: в миграциях D1 каждая команда идёт отдельно, и pragma до
-- следующей не доживает.
--
-- Поэтому всё, до чего каскад дотягивается, сначала копируется в таблицы без
-- ограничений — в них каскаду идти некуда, — а после пересборки возвращается на
-- место. `waitlist.unit_id` объявлен `SET NULL`: строки уцелеют, но потеряют
-- объект, поэтому его тоже надо вернуть.
--
-- Line comments only, never /* */ across a newline: `wrangler d1 migrations
-- apply --remote` splits the file into statements before posting them and a
-- block comment arrives truncated (SQLITE_ERROR 7500). It passes locally.

CREATE TABLE _m25_bookings AS SELECT * FROM bookings;
CREATE TABLE _m25_cleaning AS SELECT * FROM cleaning_checklist;
CREATE TABLE _m25_payments AS SELECT * FROM payments;
CREATE TABLE _m25_charges AS SELECT * FROM charges;
CREATE TABLE _m25_photos AS SELECT * FROM unit_photos;
CREATE TABLE _m25_waitlist AS SELECT id, unit_id FROM waitlist;

CREATE TABLE units_new (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT    NOT NULL CHECK (type IN ('room', 'sunbed', 'gazebo', 'vip_gazebo', 'banquet_zone', 'sauna')),
  name      TEXT    NOT NULL,
  category  TEXT,
  capacity  INTEGER NOT NULL DEFAULT 2,
  renovation_since TEXT,
  renovation_note  TEXT,
  renovation_by    INTEGER REFERENCES staff_users(id),
  part_of_unit_id  INTEGER REFERENCES units(id)
);

INSERT INTO units_new (id, type, name, category, capacity, renovation_since, renovation_note, renovation_by)
  SELECT id, type, name, category, capacity, renovation_since, renovation_note, renovation_by FROM units;

DROP TABLE units;

ALTER TABLE units_new RENAME TO units;

CREATE UNIQUE INDEX idx_units_type_name ON units (type, name);

CREATE INDEX idx_units_part_of ON units (part_of_unit_id);

DELETE FROM bookings;

DELETE FROM cleaning_checklist;

DELETE FROM payments;

DELETE FROM charges;

DELETE FROM unit_photos;

INSERT INTO bookings SELECT * FROM _m25_bookings;

INSERT INTO cleaning_checklist SELECT * FROM _m25_cleaning;

INSERT INTO payments SELECT * FROM _m25_payments;

INSERT INTO charges SELECT * FROM _m25_charges;

INSERT INTO unit_photos SELECT * FROM _m25_photos;

UPDATE waitlist SET unit_id = (SELECT w.unit_id FROM _m25_waitlist w WHERE w.id = waitlist.id);

-- Сторож. Если что-то из восстановленного не сошлось, CHECK не пропустит вставку
-- и миграция упадёт здесь — с ещё живыми копиями в _m25_*. Молча оставить
-- пустые таблицы эта миграция не должна: именно так выглядел её первый вариант,
-- который отчитался об успехе и стёр всё.
CREATE TABLE _m25_guard (ok INTEGER NOT NULL CHECK (ok = 1));

INSERT INTO _m25_guard (ok) VALUES (
  CASE WHEN (SELECT COUNT(*) FROM bookings) = (SELECT COUNT(*) FROM _m25_bookings)
        AND (SELECT COUNT(*) FROM cleaning_checklist) = (SELECT COUNT(*) FROM _m25_cleaning)
        AND (SELECT COUNT(*) FROM payments) = (SELECT COUNT(*) FROM _m25_payments)
        AND (SELECT COUNT(*) FROM charges) = (SELECT COUNT(*) FROM _m25_charges)
        AND (SELECT COUNT(*) FROM unit_photos) = (SELECT COUNT(*) FROM _m25_photos)
       THEN 1 ELSE 0 END
);

DROP TABLE _m25_guard;

DROP TABLE _m25_bookings;

DROP TABLE _m25_cleaning;

DROP TABLE _m25_payments;

DROP TABLE _m25_charges;

DROP TABLE _m25_photos;

DROP TABLE _m25_waitlist;

-- Одна сущность на весь пакет — так его и продают. Вместимость из маркетинга:
-- «до 100 гостей». Состав зоны намеренно пуст: какие именно беседки и топчаны в
-- неё входят, знает гостиница, а не миграция, и отмечается это на её странице.
INSERT INTO units (type, name, category, capacity)
  VALUES ('banquet_zone', 'Костровая зона', 'banquet', 100);

-- Событие продаётся по числу гостей, а не по числу ночей.
ALTER TABLE bookings ADD COLUMN guests_count INTEGER;

ALTER TABLE bookings ADD COLUMN price_per_person REAL;
