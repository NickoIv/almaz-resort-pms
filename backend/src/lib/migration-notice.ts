/**
 * Миграционный учёт: who has to be reported, and by when.
 *
 * Kazakhstan puts the duty on the receiving party. A hotel has **three days**
 * from a foreign guest's arrival to notify the migration service — through
 * eQonaq or the visa-migration portal — and there is a fine for missing it. The
 * notice wants the name, the citizenship, the passport number, the address of
 * stay and the dates.
 *
 * The app cannot file it: submission needs the receiving party's ЭЦП. What it
 * can do is the part that actually goes wrong — **knowing who is owed a notice
 * and how long is left** — and having the five fields ready to copy so filing
 * takes a minute rather than a search through the register.
 *
 * ## Most guests are Kazakh, and this must not shout at them
 *
 * Three states, and the difference between them is the whole design:
 *
 *   - `guest_citizenship` is **NULL** — nobody has said. Not treated as
 *     foreign, because guessing would raise a false deadline on nine bookings
 *     in ten. It is listed separately as "не указано" so that a guest who *is*
 *     foreign cannot be missed by silence.
 *   - **`KZ`** — a citizen of Kazakhstan. Nothing is owed; recorded once and
 *     never mentioned again.
 *   - **anything else** — a notice is owed, with a deadline.
 *
 * ## Three days, counted as calendar days
 *
 * The sources differ: the government decree says three days, some guidance says
 * three working days. Counting calendar days is the stricter of the two, so a
 * hotel following this app is early rather than late. Being early costs a
 * reminder; being late costs a fine.
 */

export const KZ = 'KZ'

/** How long after arrival the notice is due. */
export const NOTICE_DAYS = 3

export type MigrationRow = {
  booking_id: number
  guest_name: string
  guest_phone: string | null
  guest_citizenship: string | null
  guest_document: string | null
  date_from: string
  date_to: string
  unit_id: number
  unit_name: string
  migration_notified_at: string | null
  migration_notified_by_name: string | null
  /** Set only on the continuation of a move — see arrivalOf below. */
  arrived_on?: string | null
}

/**
 * The day the guest arrived at the hotel, which is not always the day this row
 * starts.
 *
 * A guest переселён on the second night leaves a booking whose `date_from` is
 * today, and the three-day clock does **not** restart because they changed
 * rooms. Reading `date_from` here would hand the hotel a fresh deadline on every
 * move — later than the real one, which is precisely the direction that ends in
 * a fine. `arrived_on` is carried forward through every leg of a move.
 */
export function arrivalOf(row: { date_from: string; arrived_on?: string | null }): string {
  return (row.arrived_on ?? row.date_from).slice(0, 10)
}

export type NoticeState = 'foreign' | 'local' | 'unknown'

/** Which of the three states a booking is in. */
export function noticeState(citizenship: string | null | undefined): NoticeState {
  if (!citizenship) return 'unknown'
  return citizenship.trim().toUpperCase() === KZ ? 'local' : 'foreign'
}

/** `YYYY-MM-DD`, `days` after the arrival date. Pure UTC arithmetic. */
export function noticeDue(dateFrom: string, days = NOTICE_DAYS): string {
  const start = new Date(`${dateFrom.slice(0, 10)}T00:00:00Z`)
  return new Date(start.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Days left before the notice is late — negative once it is.
 * `today` is passed in so the caller uses Almaty's day, not the server's.
 */
export function daysLeft(dateFrom: string, today: string): number {
  const due = new Date(`${noticeDue(dateFrom)}T00:00:00Z`).getTime()
  const now = new Date(`${today.slice(0, 10)}T00:00:00Z`).getTime()
  return Math.round((due - now) / 86_400_000)
}

/**
 * Whether this booking still owes a notice.
 *
 * Only once the guest has actually arrived: a booking made for next month is
 * not late, and a deadline that starts running before anyone has checked in
 * would be wrong as well as alarming.
 */
export function needsNotice(
  row: {
    guest_citizenship: string | null
    date_from: string
    arrived_on?: string | null
    migration_notified_at: string | null
  },
  today: string
): boolean {
  if (row.migration_notified_at) return false
  if (noticeState(row.guest_citizenship) !== 'foreign') return false
  return arrivalOf(row) <= today
}
