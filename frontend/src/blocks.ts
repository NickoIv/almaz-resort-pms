/** Mirrors backend/src/lib/blocks.ts. */
export const BLOCK_REASONS = ['repair', 'deep_clean', 'service', 'other'] as const

export type BlockReason = (typeof BLOCK_REASONS)[number]

export const BLOCK_REASON_LABELS: Record<string, string> = {
  repair: 'Ремонт',
  deep_clean: 'Санобработка',
  service: 'Служебная бронь',
  other: 'Другое',
}

/** Free text is required for "other" — otherwise the reason says nothing. */
export function blockNeedsNote(reason: BlockReason): boolean {
  return reason === 'other'
}

/** Lower-case, for the middle of a sentence: «снят с продажи — ремонт». */
export function blockReasonWord(reason: string): string {
  return (BLOCK_REASON_LABELS[reason] ?? reason).toLowerCase()
}
