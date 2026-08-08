/**
 * Money arithmetic for a booking.
 *
 * `bookings.total_amount` is the room/unit rate on its own. Penalties and
 * extras live in `charges` so the rate stays reportable separately, which means
 * the outstanding balance is always rate + charges − prepaid.
 *
 * `deposit_amount` is deliberately NOT part of this sum: a deposit is a
 * refundable security hold, not money owed for the stay.
 */

/** Scalar subquery totalling a booking's extra charges. */
export function chargesSumSql(bookingAlias: string): string {
  return `(SELECT COALESCE(SUM(ch.amount), 0) FROM charges ch WHERE ch.booking_id = ${bookingAlias}.id)`
}

export function remainingOf(total: number, charges: number, prepaid: number): number {
  return Number((total + charges - prepaid).toFixed(2))
}