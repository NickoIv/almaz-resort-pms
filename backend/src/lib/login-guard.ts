import { SQL_NOW } from './time'

/**
 * Slowing down PIN guessing.
 *
 * A four-digit PIN is 10 000 possibilities. That is a perfectly sensible secret
 * for a device someone has to be holding, and a bad one for an endpoint anybody
 * on the internet can call as fast as they like — which is what this Worker is.
 * The fix is not a longer PIN, which staff would write on the wall; it is
 * making the guesses cost time.
 *
 * The shape of the rule matters as much as its existence:
 *
 *   - **Per phone, never per IP.** All the staff share one hotel network, so an
 *     address-based rule would let one person fat-fingering their PIN lock out
 *     the whole shift.
 *   - **Unknown numbers are counted too.** If only real accounts were tracked,
 *     "too many attempts" would confirm that an account exists, which is the
 *     exact thing the login handler answers identically to avoid.
 *   - **Generous before the first lock, then sharply escalating.** Somebody
 *     coming back from a day off gets several tries; a script gets a minute,
 *     then five, then an hour, and 10 000 guesses stops being a plan.
 */

/** Failures allowed before the first lock. Real people mistype; scripts do not stop. */
const FREE_ATTEMPTS = 5

/** Lock durations in minutes, by how far past the threshold the failures are. */
const BACKOFF_MINUTES = [1, 5, 15, 60]

/**
 * A run of failures older than this is forgotten.
 *
 * Long enough that an attacker cannot simply wait out the counter at any useful
 * rate — pausing an hour between every five guesses turns 10 000 attempts into
 * years — and short enough that a genuine bad day does not follow someone
 * around for a week.
 */
const FORGET_AFTER_MINUTES = 60

export type LockState = { locked: false } | { locked: true; minutesLeft: number }

type AttemptRow = {
  failures: number
  locked_until: string | null
  stale: number
  minutes_left: number | null
}

/**
 * Whether this phone is currently refused, without touching the PIN.
 *
 * Checked before the password comparison so a locked account costs an attacker
 * a database read rather than a hash verification, and so a correct guess
 * arriving during a lock still does not hand over a token.
 */
export async function lockState(db: D1Database, phone: string): Promise<LockState> {
  const row = await db
    .prepare(
      `SELECT failures, locked_until,
              CASE WHEN datetime(last_failure_at) <
                        datetime(${SQL_NOW}, '-${FORGET_AFTER_MINUTES} minutes')
                   THEN 1 ELSE 0 END AS stale,
              CASE WHEN locked_until IS NULL THEN NULL
                   ELSE (julianday(locked_until) - julianday(${SQL_NOW})) * 1440
              END AS minutes_left
         FROM login_attempts
        WHERE phone = ?`
    )
    .bind(phone)
    .first<AttemptRow>()

  if (!row || row.stale === 1) return { locked: false }
  if (row.minutes_left === null || row.minutes_left <= 0) return { locked: false }

  // Rounded up: telling someone to wait "0 минут" when the lock is still on
  // invites them to hammer the button.
  return { locked: true, minutesLeft: Math.max(1, Math.ceil(row.minutes_left)) }
}

/**
 * Records one failed attempt and returns the lock it caused, if any.
 *
 * The counter restarts rather than accumulating when the previous run has gone
 * stale, so a person who mistyped twice last month starts from zero today.
 */
export async function recordFailure(db: D1Database, phone: string): Promise<LockState> {
  await db
    .prepare(
      `INSERT INTO login_attempts (phone, failures, last_failure_at)
       VALUES (?, 1, ${SQL_NOW})
       ON CONFLICT (phone) DO UPDATE SET
         failures = CASE
           WHEN datetime(login_attempts.last_failure_at) <
                datetime(${SQL_NOW}, '-${FORGET_AFTER_MINUTES} minutes')
           THEN 1
           ELSE login_attempts.failures + 1
         END,
         last_failure_at = ${SQL_NOW}`
    )
    .bind(phone)
    .run()

  const row = await db
    .prepare('SELECT failures FROM login_attempts WHERE phone = ?')
    .bind(phone)
    .first<{ failures: number }>()

  const failures = row?.failures ?? 1
  if (failures <= FREE_ATTEMPTS) return { locked: false }

  const step = Math.min(failures - FREE_ATTEMPTS - 1, BACKOFF_MINUTES.length - 1)
  const minutes = BACKOFF_MINUTES[step]

  // Interpolated rather than bound: SQLite will not take a parameter inside a
  // datetime modifier string, and the value comes from BACKOFF_MINUTES, not
  // from the request.
  await db
    .prepare(
      `UPDATE login_attempts
          SET locked_until = datetime(${SQL_NOW}, '+${minutes} minutes')
        WHERE phone = ?`
    )
    .bind(phone)
    .run()

  return { locked: true, minutesLeft: minutes }
}

/** Forgets a phone's failures. Called on every successful sign-in. */
export async function clearFailures(db: D1Database, phone: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE phone = ?').bind(phone).run()
}

/**
 * Drops rows nobody is being slowed down by any more.
 *
 * Invented phone numbers each leave a row, so without this the table grows for
 * as long as somebody feels like sending traffic.
 */
export async function pruneLoginAttempts(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM login_attempts
        WHERE datetime(last_failure_at) < datetime(${SQL_NOW}, '-1 day')
          AND (locked_until IS NULL OR datetime(locked_until) < ${SQL_NOW})`
    )
    .run()
  return result.meta.changes ?? 0
}

/** The message a locked-out person sees. Same wording whoever they are. */
export function lockMessage(minutesLeft: number): string {
  return `Слишком много попыток входа. Повторите через ${minutesLeft} мин.`
}
