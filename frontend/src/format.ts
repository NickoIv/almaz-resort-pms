/** Formatting helpers shared across the UI. */

/** 120000 -> "120 000 ₸" */
export function money(amount: number | undefined | null, currency = 'KZT'): string {
  const value = Number(amount ?? 0)
  const symbol = currency === 'KZT' ? '₸' : currency === 'USD' ? '$' : currency
  return `${value.toLocaleString('ru-RU')} ${symbol}`
}

/** "2026-08-08" -> "8 авг" */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.slice(0, 10))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function dateRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return '—'
  return `${shortDate(from)} — ${shortDate(to)}`
}

/** Today in the local timezone as YYYY-MM-DD. */
export function todayIso(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
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

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}