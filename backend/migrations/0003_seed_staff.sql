-- Seed: initial staff accounts, one per role.
-- PINs are PBKDF2-SHA256 (100k iterations) in the format
--   pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>
-- Starting PINs: admin 1234, housekeeper 2345, waiter 3456.
-- Change these before the system goes live.

INSERT INTO staff_users (name, phone, role, pin_code_hash) VALUES
  ('Нурлан Абдразаков', '+77011112233', 'admin', 'pbkdf2$sha256$100000$90kst2A3rA55CUzd1h8WjA==$4ihZLFctp+Wi2iZZFMogv5bvVIssNVeI6LCZfzFdfMY='),
  ('Айгуль Сериккызы', '+77022223344', 'housekeeper', 'pbkdf2$sha256$100000$Owt6IegF2hqoJAo8XS6GVg==$nx4pEKW8BiT1T89ije6X3EkyslrDdXv7SRZPv/7/g0I='),
  ('Ержан Тулеуов', '+77033334455', 'waiter', 'pbkdf2$sha256$100000$OeW9K50fDK+Q3g6oxNRbaQ==$+yU5W8D0AupfWMo/PeJhm1IXohtCYMI439NUOZCd+B0=');