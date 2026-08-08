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
