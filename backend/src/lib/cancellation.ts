/**
 * Why a booking stopped. `status = 'free'` covers both a normal checkout and a
 * cancellation, so the reason is what tells them apart after the fact.
 */
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

export function isCancelReason(value: unknown): value is CancelReason {
  return CANCEL_REASONS.includes(value as CancelReason)
}
