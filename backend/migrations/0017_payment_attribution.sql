-- Who took the money, and who wrote it down.
--
-- The admin is the only role that records a payment, but the admin is often
-- not the person the guest actually handed the cash to — a waiter takes it at
-- a gazebo and it is entered later. Until now the row said only how much, by
-- what method and when, so "who has this money" was a question the database
-- could not answer, and an evening that did not balance had nowhere to start.
--
-- Two people, deliberately kept apart:
--
--   received_by  the member of staff who physically took it from the guest
--   recorded_by  whoever entered it into the app, which is always an admin
--
-- Both are nullable and both stay null on every existing row. That is the
-- honest state: nobody knows who took those payments, and inventing an answer
-- by defaulting them to the admin would make the record look reliable exactly
-- where it is not.
--
-- ON DELETE SET NULL rather than CASCADE, for the same reason the staff table
-- disables accounts instead of deleting them: money history must survive the
-- person leaving.
--
-- NOTE — line comments only, no /* */ across a newline. See 0015 for why.

ALTER TABLE payments ADD COLUMN received_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN recorded_by INTEGER REFERENCES staff_users (id) ON DELETE SET NULL;

-- The end-of-day question is "what did each person take", so that is the index.
CREATE INDEX IF NOT EXISTS idx_payments_received_by ON payments (received_by, paid_at);
