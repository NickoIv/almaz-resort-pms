/** Mirrors backend/src/lib/cancellation.ts. */
export const CANCEL_REASONS = [
  'checked_out',
  'guest_changed_mind',
  'no_payment',
  'duplicate',
  'other',
] as const

export type CancelReason = (typeof CANCEL_REASONS)[number]

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  checked_out: 'Обычный выезд',
  guest_changed_mind: 'Гость передумал',
  no_payment: 'Не подтверждена оплата',
  duplicate: 'Дубль брони',
  other: 'Другое',
}

/** Free text is required for "other" — otherwise the reason says nothing. */
export function needsNote(reason: CancelReason): boolean {
  return reason === 'other'
}

/**
 * Written by the transfer endpoint and never offered in the selector above —
 * see the note in backend/src/lib/cancellation.ts. A leg of a move is closed by
 * moving the guest, not by picking a reason from a list.
 */
export const TRANSFER_REASON = 'transferred'

/**
 * How a reason reads on screen, including the ones nobody can choose.
 * Use this everywhere a stored `cancel_reason` is displayed; CANCEL_REASON_LABELS
 * is the selector's list and would print «transferred» raw.
 */
export const REASON_LABELS: Record<string, string> = {
  ...CANCEL_REASON_LABELS,
  [TRANSFER_REASON]: 'Переселение',
}
