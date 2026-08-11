import type { UnitType } from '../types'

/**
 * The price list, and what a stay costs by it.
 *
 * The one thing worth taking from a chain hotel's PMS for a place like this:
 * "для загородных отелей цена заезда обычно выше в пятницу-субботу". Taura is
 * an hour outside Almaty and fills at the weekend, so a single price per room
 * is either too low on Saturday or too high on Tuesday. Until now every amount
 * was typed into the booking form by hand, which is the most repeated and most
 * error-prone action in the app.
 *
 * Deliberately **two prices and an optional season**, not the seven day
 * categories, packages, early-booking and length-of-stay rules a chain sells.
 * Fourteen rooms do not need a tariff engine; they need Friday to cost more
 * than Tuesday without anybody having to remember it.
 *
 * Nothing here decides anything on its own: the quote is a *suggestion* the
 * booking form fills in, and whoever is at the desk can type over it. An empty
 * price list quotes nothing at all and the app behaves exactly as before.
 */

export type Rate = {
  id: number
  unit_type: UnitType
  /** NULL — any category of this type. */
  category: string | null
  weekday_price: number
  weekend_price: number
  season_name: string | null
  season_from: string | null
  season_to: string | null
}

export type QuoteNight = {
  date: string
  /** Which of the two prices applied, so the breakdown can say why. */
  kind: 'weekday' | 'weekend'
  season: string | null
  price: number
}

export type Quote = {
  total: number
  nights: QuoteNight[]
  /** True when no row in the list covered this unit — nothing to suggest. */
  empty: boolean
}

/**
 * Friday and Saturday nights carry the weekend price.
 *
 * The *night* of Friday is the one you arrive for, so this asks about the date
 * the guest sleeps, not the date they leave. Sunday night is a weekday price:
 * they have gone home by then.
 *
 * Pure UTC arithmetic on a date-only string — the same reason `addDaysIso` in
 * the frontend does it that way. Parsing as local midnight and reading back a
 * weekday puts the answer a day out west of Greenwich.
 */
export function isWeekendNight(iso: string): boolean {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()
  return day === 5 || day === 6
}

/** Whether a season covers a date. Both bounds inclusive; either may be open. */
function seasonCovers(rate: Rate, iso: string): boolean {
  const day = iso.slice(0, 10)
  if (!rate.season_from && !rate.season_to) return false
  if (rate.season_from && day < rate.season_from) return false
  if (rate.season_to && day > rate.season_to) return false
  return true
}

/**
 * The row that governs one night, most specific first.
 *
 * A season beats the base price, and a row naming the category beats one that
 * does not. So «Лето, люкс» wins over «Лето, любой номер», which wins over
 * «Круглый год, люкс», which wins over «Круглый год, любой номер». Anything
 * else would make the list impossible to reason about from the screen.
 */
export function pickRate(
  rates: Rate[],
  type: UnitType,
  category: string | null,
  iso: string
): Rate | null {
  const forType = rates.filter((rate) => rate.unit_type === type)
  const seasonal = forType.filter((rate) => seasonCovers(rate, iso))
  const base = forType.filter((rate) => !rate.season_from && !rate.season_to)

  const byCategory = (list: Rate[]) => list.find((rate) => rate.category === category)
  const anyCategory = (list: Rate[]) => list.find((rate) => rate.category === null)

  return (
    byCategory(seasonal) ?? anyCategory(seasonal) ?? byCategory(base) ?? anyCategory(base) ?? null
  )
}

/** Whole days between two `YYYY-MM-DD` values, on UTC arithmetic. */
function nightsBetween(from: string, to: string): string[] {
  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`)
  const end = new Date(`${to.slice(0, 10)}T00:00:00Z`)
  const out: string[] = []
  for (let d = start; d < end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * What a stay comes to.
 *
 * Rooms are priced per night — the half-open rule that governs everything else
 * in this app applies here too, so 15→18 is the nights of the 15th, 16th and
 * 17th and the checkout day is not charged.
 *
 * Recreation units are sold by the hour and a gazebo booked 13:00–18:00 is one
 * sitting, not a night. They are quoted as a **single** line priced on the day
 * it starts, because that is how the hotel sells them; charging a sunbed by
 * the night would produce a nonsense figure on every restaurant booking.
 */
export function quoteStay(
  rates: Rate[],
  unit: { type: UnitType; category: string | null },
  dateFrom: string,
  dateTo: string
): Quote {
  const days =
    unit.type === 'room'
      ? nightsBetween(dateFrom, dateTo)
      : // One sitting, priced on the day it starts.
        [dateFrom.slice(0, 10)]

  const nights: QuoteNight[] = []
  for (const day of days) {
    const rate = pickRate(rates, unit.type, unit.category, day)
    if (!rate) continue
    const weekend = isWeekendNight(day)
    nights.push({
      date: day,
      kind: weekend ? 'weekend' : 'weekday',
      season: rate.season_name,
      price: weekend ? rate.weekend_price : rate.weekday_price,
    })
  }

  // A partial answer is worse than none: if any night of the stay has no price,
  // the total would silently undercharge for the rest. Either the list covers
  // the stay or it says nothing.
  const empty = nights.length === 0 || nights.length !== days.length
  return {
    total: empty ? 0 : Number(nights.reduce((sum, night) => sum + night.price, 0).toFixed(2)),
    nights: empty ? [] : nights,
    empty,
  }
}
