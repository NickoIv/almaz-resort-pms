-- Which channel the scheduled digest goes to.
-- 'whatsapp' (default), 'telegram', or 'both'. Telegram is kept as a
-- secondary channel rather than removed.

INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_channel', 'whatsapp');