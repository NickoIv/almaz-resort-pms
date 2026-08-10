/** Formatting helpers shared across the UI. */

/**
 * The hotel runs on Almaty time (UTC+5, no DST since Kazakhstan unified its
 * zones in 2024). Staff open this app from other timezones, so "today" must
 * mean today *at the hotel* — never the viewer's device date.
 *
 * This mirrors `backend/src/lib/time.ts`, which shifts D1's UTC `now` by the
 * same fixed amount. The offset is hard-coded rather than read from the IANA
 * database on purpose: if it were auto-updating here but fixed on the server,
 * the two would silently disagree the day the rule changed. Change both
 * together.
 */
export const ALMATY_UTC_OFFSET_HOURS = 5

/**
 * "Now" at the hotel, as a Date whose **UTC** fields hold Almaty wall-clock
 * time. Read it with `getUTCHours`, `toISOString` and friends — the local
 * getters would re-apply the viewer's offset and undo the shift.
 */
export function almatyNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + ALMATY_UTC_OFFSET_HOURS * 3_600_000)
}

/** Current time at the hotel as "14:32". */
export function almatyClock(now: Date = new Date()): string {
  return almatyNow(now).toISOString().slice(11, 16)
}

/** The hotel's current month as "2026-08". */
export function almatyMonth(now: Date = new Date()): string {
  return almatyNow(now).toISOString().slice(0, 7)
}

/** The hotel's current year, e.g. 2026. */
export function almatyYear(now: Date = new Date()): number {
  return almatyNow(now).getUTCFullYear()
}

/**
 * First day of the hotel's current month, shifted by `offset` months.
 * offset -1 gives last month, 0 gives this month.
 */
export function almatyMonthStart(offset = 0, now: Date = new Date()): string {
  const here = almatyNow(now)
  const date = new Date(Date.UTC(here.getUTCFullYear(), here.getUTCMonth() + offset, 1))
  return date.toISOString().slice(0, 10)
}

/** Falls back to the raw code for anything not listed, so nothing renders blank. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  KZT: '₸',
  USD: '$',
  CNY: '¥',
}

/** 120000 -> "120 000 ₸" */
export function money(amount: number | undefined | null, currency = 'KZT'): string {
  const value = Number(amount ?? 0)
  return `${value.toLocaleString('ru-RU')} ${CURRENCY_SYMBOLS[currency] ?? currency}`
}

/** "2026-08-08" -> "8 авг" */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.slice(0, 10))
  if (Number.isNaN(date.getTime())) return value
  // A date-only string parses as UTC midnight; rendering it in the viewer's
  // timezone would show the previous day anywhere west of Greenwich.
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function dateRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return '—'
  return `${shortDate(from)} — ${shortDate(to)}`
}

/**
 * Today at the hotel as YYYY-MM-DD — the default for every date field and the
 * "today" the calendar highlights. Independent of the viewer's timezone.
 */
export function todayIso(now: Date = new Date()): string {
  return almatyNow(now).toISOString().slice(0, 10)
}

/** "2026-08-08 14:00" -> "14:00" */
export function clockTime(value: string | null | undefined): string {
  if (!value) return '—'
  const time = value.slice(11, 16)
  return time || '00:00'
}

/**
 * Recreation units are booked by the hour, so show the clock rather than dates.
 * Same-day bookings collapse to "14:00 — 18:00"; anything spanning midnight
 * keeps the day so the range stays unambiguous.
 */
export function timeRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return '—'
  const sameDay = from.slice(0, 10) === to.slice(0, 10)
  if (sameDay) {
    return `${shortDate(from)}, ${clockTime(from)} — ${clockTime(to)}`
  }
  return `${shortDate(from)} ${clockTime(from)} — ${shortDate(to)} ${clockTime(to)}`
}

/** "2026-08" -> "авг 2026" */
export function monthShort(month: string): string {
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const [year, index] = month.split('-')
  return `${names[Number(index) - 1]} ${year.slice(2)}`
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

/** Compact money for axis ticks and stat tiles: 1 250 000 -> "1,25 млн" */
export function compactMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace('.', ',')} млн`
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1000)} тыс`
  return String(Math.round(value))
}

/**
 * Adds whole days to a YYYY-MM-DD value.
 *
 * Pure UTC arithmetic on purpose: the previous version parsed the string as
 * browser-local midnight and then read it back as UTC, so east of Greenwich
 * the result landed a day short — in UTC+7, addDaysIso(today, 1) returned
 * today, making the default checkout date the same as the check-in date.
 */
export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}
/** Whole days between two YYYY-MM-DD strings. For a stay, that is its nights. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/**
 * Russian plural agreement: pluralRu(2, ['ночь', 'ночи', 'ночей']) -> 'ночи'.
 *
 * The naive `n === 1 ? … : n < 5 ? … : …` gets 21 and 11 wrong in opposite
 * directions — 21 takes the singular and 11 does not — and a booking is exactly
 * where a stray «21 ночей» is read as the app not knowing what it is doing.
 */
export function pluralRu(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100
  if (n >= 11 && n <= 14) return forms[2]
  const last = n % 10
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}

/** 95 -> "1 ч 35 мин"; under an hour stays in minutes. */
export function elapsedLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  if (safe < 60) return `${safe} мин`
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`
}
