-- Brute-force protection for the login screen.
--
-- PINs are four digits and the Worker is on the public internet, so before this
-- existed an account was 10 000 guesses away from anyone who knew a staff phone
-- number, with nothing slowing the guessing down. A script would have finished
-- in minutes.
--
-- Keyed by the phone *as submitted*, not by a staff id: a number that matches
-- no account is counted exactly the same way. Otherwise a lockout message would
-- itself confirm that an account exists, undoing the care taken in the login
-- handler to answer identically for an unknown phone and a wrong PIN.
--
-- Deliberately not keyed by IP as well. The staff are on one hotel network
-- behind one address, so an IP rule would let a single mistyped shift lock out
-- everybody at once — the failure mode would be worse than the attack.
--
-- NOTE — line comments only, no /* */ across a newline. See 0015 for why.

CREATE TABLE IF NOT EXISTS login_attempts (
  phone            TEXT    PRIMARY KEY,
  -- Consecutive failures. Reset on a successful sign-in, and treated as stale
  -- once the last failure is old enough that a real attack would have moved on.
  failures         INTEGER NOT NULL DEFAULT 0,
  last_failure_at  TEXT    NOT NULL DEFAULT (datetime('now', '+5 hours')),
  -- When set and in the future, the account refuses to even check the PIN.
  locked_until     TEXT
) WITHOUT ROWID;

-- Rows for numbers nobody uses are pruned by age on the scheduled sweep, so a
-- flood of invented phone numbers cannot grow the table without bound.
CREATE INDEX IF NOT EXISTS idx_login_attempts_seen ON login_attempts (last_failure_at);
