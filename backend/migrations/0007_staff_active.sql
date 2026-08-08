-- Staff accounts are disabled, never deleted: bookings, payments, cleaning
-- checklist rows and audit_log all reference staff_user_id, and that history
-- has to keep resolving to a name after someone leaves.

ALTER TABLE staff_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_staff_active ON staff_users (is_active);
