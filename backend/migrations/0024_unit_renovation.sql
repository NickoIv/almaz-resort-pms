-- Объект на реставрации: его ещё физически нет.
--
-- Отдельно от unit_blocks, и это не дублирование. Блокировка — это отрезок
-- календаря: «107 снят с продажи с 10 по 15, ремонт», у неё есть конец, и она
-- отвечает на вопрос «что продаём на эти даты». Реставрация — свойство самого
-- объекта: номера пока не существует, дату открытия никто не знает, и вопрос
-- другой — «сколько у нас вообще номеров». Загонять её в блокировку значило бы
-- каждый раз выдумывать дату конца и продлевать её, когда выдуманная наступит.
--
-- NULL — обычный объект. Так и остаются все существующие: отмечает человек,
-- когда это правда, а не миграция за него.
--
-- Line comments only, never /* */ across a newline: `wrangler d1 migrations
-- apply --remote` splits the file into statements before posting them and a
-- block comment arrives truncated (SQLITE_ERROR 7500). It passes locally.

ALTER TABLE units ADD COLUMN renovation_since TEXT;
ALTER TABLE units ADD COLUMN renovation_note TEXT;
ALTER TABLE units ADD COLUMN renovation_by INTEGER REFERENCES staff_users(id);
