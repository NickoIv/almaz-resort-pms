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

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}