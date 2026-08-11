import { HTTPException } from 'hono/http-exception'

/**
 * Объект, снятый с продажи.
 *
 * A room with a burst pipe is not booked — it is *unavailable*, and those are
 * different facts. Before this existed the only way to express the second was
 * to write a fake booking on a guest called «Ремонт», which quietly poisoned
 * everything downstream: занятость counted the nights as sold, the guest's
 * history grew a person who does not exist, «Начислено по броням» added up a
 * price nobody would pay, and the no-show alert eventually fired asking the
 * desk to check in a leak.
 *
 * In a fourteen-room hotel one room is seven per cent of the inventory, so
 * "which rooms can I actually sell tonight" has to be answerable without
 * someone remembering that 107 is out.
 */

/**
 * Why an object is off sale. Kept short on purpose — this is a reason a person
 * picks in two seconds at a desk, not a maintenance taxonomy. `other` demands a
 * note, the same rule cancellation reasons follow: a reason that says nothing
 * is worse than no reason, because it looks like an answer.
 */
export const BLOCK_REASONS = ['repair', 'deep_clean', 'service', 'other'] as const

export type BlockReason = (typeof BLOCK_REASONS)[number]

export function isBlockReason(value: unknown): value is BlockReason {
  return BLOCK_REASONS.includes(value as BlockReason)
}

export function blockNeedsNote(reason: BlockReason): boolean {
  return reason === 'other'
}

export type UnitBlock = {
  id: number
  unit_id: number
  date_from: string
  date_to: string
  reason: BlockReason
  note: string | null
  created_at: string
  created_by: number | null
  created_by_name?: string | null
}

/**
 * Half-open overlap, in the one place every caller must use it.
 *
 * `datetime()` rather than plain string comparison, matching `assertNoOverlap`
 * in routes/bookings.ts: a gazebo's `date_to` carries a time and a room's does
 * not, and the two have to be comparable. A block written as bare dates against
 * an hourly booking still lines up, because `datetime('2027-03-15')` is
 * midnight.
 */
export const BLOCK_OVERLAP = `datetime(date_from) < datetime(?) AND datetime(date_to) > datetime(?)`

/**
 * Refuses to sell an object that is off the market for those dates.
 *
 * Called from every path that writes a booking — create, edit, group, quick
 * seat and переселение. A block that only some of them respected would be a
 * room that is out of order until somebody uses the other button.
 */
export async function assertNotBlocked(
  db: D1Database,
  unitId: number,
  dateFrom: string,
  dateTo: string
): Promise<void> {
  const clash = await db
    .prepare(
      `SELECT id, date_from, date_to, reason FROM unit_blocks
        WHERE unit_id = ? AND ${BLOCK_OVERLAP}
        LIMIT 1`
    )
    .bind(unitId, dateTo, dateFrom)
    .first<{ id: number; date_from: string; date_to: string; reason: BlockReason }>()

  if (clash) {
    throw new HTTPException(409, {
      message:
        `Объект снят с продажи с ${clash.date_from.slice(0, 10)} по ` +
        `${clash.date_to.slice(0, 10)} (${BLOCK_REASON_LABELS[clash.reason] ?? clash.reason})`,
    })
  }
}

/** Russian for the reasons, used in the messages this module raises. */
export const BLOCK_REASON_LABELS: Record<string, string> = {
  repair: 'ремонт',
  deep_clean: 'санобработка',
  service: 'служебная бронь',
  other: 'другое',
}
