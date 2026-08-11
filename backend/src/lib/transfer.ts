/**
 * Переселение — moving a guest to another unit without losing the stay.
 *
 * Until now the only way to move somebody was to cancel their booking and write
 * a new one. That throws away the payments, the extra charges, the verification
 * stamp, the group, the migration notice and the guest's history — every fact
 * about the stay except the one that changed. In a fourteen-room hotel at full
 * occupancy this is a weekly operation, not an exotic one: a leaking tap, a
 * noisy neighbour, a family that turns out to need the adjoining pair.
 *
 * ## Two shapes, and the dates decide which
 *
 * **The stay has not started** (`date_from` is today or later) — the booking
 * simply moves. `bookings.unit_id` changes and nothing else does: the same row,
 * the same id, the same money, the same audit trail. This is the shape the whole
 * feature is for and it is lossless.
 *
 * **The stay is under way** (`date_from` < today < `date_to`) — a booking row
 * carries one `unit_id`, so a guest who slept three nights in 101 and moves to
 * 105 cannot be one row without losing the fact that 101 was occupied on those
 * nights. The stay is **split**: the first leg is closed on today's date with
 * the reason «Переселение», and a continuation is created on the new unit from
 * today to the original checkout. `moved_from_booking_id` ties them back
 * together, so the pair still reads as one arrival.
 *
 * A split is not something the caller chooses. It follows from the dates,
 * because the dates are what the guest is billed on — a switch would only be a
 * way to record nights in a room nobody slept in.
 *
 * ## What deliberately is not supported
 *
 * **A move dated in the future.** «В четверг переселим их в 105» is a plan, not
 * a transaction: nothing about the hotel changes until Thursday, and a booking
 * written now would hold Thursday's room against a guest who may check out on
 * Wednesday. A transfer is two taps on the day. Rather than half-support it,
 * the endpoint refuses it plainly.
 *
 * **A move between types.** A room and a gazebo are not substitutes for one
 * another — one is sold by the night and the other by the sitting — so the
 * target must be the same type as the source. Recreation units are always moved
 * whole for the same reason: a sitting has no nights to split at.
 */

/** Whole nights between two `YYYY-MM-DD` values, on UTC arithmetic. */
export function nightsBetween(from: string, to: string): number {
  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime()
  const end = new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime()
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

/**
 * How the agreed price divides between the two legs when nobody re-quotes it.
 *
 * Pro rata by night, in whole currency units, with the remainder left on the
 * **first** leg — the same rule the group booking uses, so the parts always add
 * back to the sum the guest agreed to. That matters more than accuracy per
 * night here: a room move is usually the hotel's doing, and a guest who is asked
 * to pack their suitcase should not also find the bill has moved.
 *
 * It is only a default. The admin sees both figures before confirming and can
 * type over either — a dearer room has to be re-quoted, and this cannot know
 * that.
 */
export function prorate(total: number, nightsBefore: number, nightsTotal: number): {
  stay: number
  move: number
} {
  if (nightsTotal <= 0 || total <= 0) return { stay: 0, move: Math.max(0, total) }
  const move = Math.floor((total * Math.max(0, nightsTotal - nightsBefore)) / nightsTotal)
  return { stay: Number((total - move).toFixed(2)), move }
}

/**
 * What travels with the guest when the stay is split.
 *
 * The first leg is left **settled**: whatever was prepaid beyond what those
 * nights and their charges came to follows the guest to the continuation, so a
 * stay paid for up front does not turn into one row in credit and another in
 * debt. The carry is booked as a matching pair of `adjustment` rows — nobody
 * handed anything over, so calling it cash would put money in a till that never
 * saw any, and the pair sums to zero in every revenue report.
 *
 * A shortfall is **not** carried. A guest who still owes for the nights they
 * slept in 101 owes it for those nights; inventing a payment on that leg to
 * move the debt forward would be a lie in the ledger, and the admin can move it
 * honestly by re-quoting the two legs, which the dialog offers.
 */
export function carryOver(prepaid: number, stayTotal: number, stayCharges: number): number {
  return Number(Math.max(0, prepaid - stayTotal - stayCharges).toFixed(2))
}
