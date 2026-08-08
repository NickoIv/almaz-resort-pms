-- When a checklist item was raised, so the Cleaning page can show how long a
-- unit has been waiting. Derived from the checklist rather than a column on
-- units: the list is created the moment a unit needs cleaning and deleted when
-- it is reset, so its own age is the SLA clock.
--
-- Stored as Almaty wall-clock to match every other timestamp comparison.

ALTER TABLE cleaning_checklist ADD COLUMN created_at TEXT;

-- Existing rows have no history; treat them as raised now rather than as
-- infinitely overdue, which would show every unit in red on first deploy.
UPDATE cleaning_checklist SET created_at = datetime('now', '+5 hours') WHERE created_at IS NULL;
