/**
 * Phone normalisation, shared by login, staff management and guest history.
 *
 * Staff type their number differently every time ("+7 (701) 111-22-33" vs
 * "+77011112233"), so the stored form is the one comparison key: punctuation
 * stripped, leading + preserved.
 */
export function normalizePhone(phone: unknown): string {
  return String(phone ?? '').replace(/[\s()\-.]/g, '')
}

/** Loose check — enough to catch typos without rejecting foreign numbers. */
export function isPlausiblePhone(phone: string): boolean {
  return /^\+?\d{9,15}$/.test(phone)
}
