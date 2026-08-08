import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { chargesSumSql } from '../lib/money'
import { SQL_TODAY } from '../lib/time'
import type { AppEnv, UnitType } from '../types'

const analytics = new Hono<AppEnv>()

// Analytics is admin-only, per the role model.
analytics.use('*', requireRole('admin'))

const RESTAURANT_LABEL = 'restaurant'

function categoryOf(type: UnitType): 'rooms' | 'restaurant' {
  return type === 'room' ? 'rooms' : RESTAURANT_LABEL
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Inclusive day count between two ISO dates. */
function daySpan(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

type TypeRow = { type: UnitType; revenue: number; payments: number; bookings: number }
type MonthRow = { month: string; rooms: number; restaurant: number; revenue: number }

/**
 * GET /api/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Revenue is what was actually collected (rows in `payments`), not what was
 * quoted — an unpaid booking should not show up as income.
 */
analytics.get('/summary', async (c) => {
  const today = await c.env.DB.prepare(`SELECT ${SQL_TODAY} AS today`).first<{ today: string }>()
  const defaultTo = today?.today ?? new Date().toISOString().slice(0, 10)
  const defaultFrom = `${defaultTo.slice(0, 7)}-01`

  const from = c.req.query('from') ?? defaultFrom
  const to = c.req.query('to') ?? defaultTo

  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new HTTPException(400, { message: 'from and to must be YYYY-MM-DD dates' })
  }
  if (to < from) {
    throw new HTTPException(400, { message: 'to must not be earlier than from' })
  }

  // ── Revenue per unit type ────────────────────────────────────────────────
  const { results: typeRows } = await c.env.DB.prepare(
    `SELECT u.type AS type,
            SUM(p.amount) AS revenue,
            COUNT(p.id) AS payments,
            COUNT(DISTINCT b.id) AS bookings
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN units u ON u.id = b.unit_id
     WHERE date(p.paid_at) BETWEEN date(?) AND date(?)
     GROUP BY u.type`
  )
    .bind(from, to)
    .all<TypeRow>()

  const byType = typeRows.map((row) => ({
    type: row.type,
    category: categoryOf(row.type),
    revenue: row.revenue ?? 0,
    payments: row.payments ?? 0,
    bookings: row.bookings ?? 0,
  }))

  const byCategory = {
    rooms: byType.filter((r) => r.category === 'rooms').reduce((sum, r) => sum + r.revenue, 0),
    restaurant: byType
      .filter((r) => r.category === RESTAURANT_LABEL)
      .reduce((sum, r) => sum + r.revenue, 0),
  }
  const totalRevenue = byCategory.rooms + byCategory.restaurant

  // ── Accrued value and outstanding debt ───────────────────────────────────
  //
  // `revenue` above is money actually collected. That is the correct figure for
  // revenue, but on its own it reads as "0 ₸ despite active bookings" whenever
  // guests have booked and not yet paid. These two numbers make the difference
  // explicit: what the bookings in this range are worth, and what is still owed.
  const accruedRow = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(b.total_amount + ${chargesSumSql('b')}), 0) AS accrued,
       COALESCE(SUM(MAX(0, b.total_amount + ${chargesSumSql('b')} - b.prepaid_amount)), 0) AS outstanding,
       COUNT(*) AS bookings
     FROM bookings b
     WHERE b.status <> 'free'
       AND date(b.date_from) <= date(?) AND date(b.date_to) >= date(?)`
  )
    .bind(to, from)
    .first<{ accrued: number; outstanding: number; bookings: number }>()

  // ── Room occupancy ───────────────────────────────────────────────────────
  // Nights sold = the part of each stay that falls inside the range.
  //
  // Every status counts, including 'free': a guest who has checked out is set
  // back to 'free', so filtering it away would report ~0% for any past period.
  // The trade-off is that `bookings.status` has no separate 'cancelled' state,
  // so a cancelled booking is counted here as if it had been slept in.
  const nightsRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(
       MAX(0,
         julianday(MIN(date(b.date_to), date(?, '+1 day'))) -
         julianday(MAX(date(b.date_from), date(?)))
       )
     ), 0) AS nights
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     WHERE u.type = 'room'
       AND date(b.date_from) <= date(?) AND date(b.date_to) >= date(?)`
  )
    .bind(to, from, to, from)
    .first<{ nights: number }>()

  const roomCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM units WHERE type = 'room'"
  ).first<{ count: number }>()

  const nightsSold = Math.round(nightsRow?.nights ?? 0)
  const nightsAvailable = (roomCount?.count ?? 0) * daySpan(from, to)
  const occupancyRate = nightsAvailable > 0 ? nightsSold / nightsAvailable : 0

  // ── Monthly series for the chart (last 6 months up to `to`) ──────────────
  const seriesStart = `${shiftMonth(to.slice(0, 7), -5)}-01`
  const { results: monthRows } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', p.paid_at) AS month,
            SUM(CASE WHEN u.type = 'room' THEN p.amount ELSE 0 END) AS rooms,
            SUM(CASE WHEN u.type <> 'room' THEN p.amount ELSE 0 END) AS restaurant,
            SUM(p.amount) AS revenue
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN units u ON u.id = b.unit_id
     WHERE date(p.paid_at) >= date(?) AND date(p.paid_at) <= date(?)
     GROUP BY month
     ORDER BY month`
  )
    .bind(seriesStart, to)
    .all<MonthRow>()

  // Fill gaps so the chart keeps a continuous axis.
  const byMonth = new Map(monthRows.map((row) => [row.month, row]))
  const months = Array.from({ length: 6 }, (_, index) => {
    const month = shiftMonth(to.slice(0, 7), index - 5)
    const row = byMonth.get(month)
    return {
      month,
      rooms: row?.rooms ?? 0,
      restaurant: row?.restaurant ?? 0,
      revenue: row?.revenue ?? 0,
    }
  })

  const current = months[months.length - 1]
  const previous = months[months.length - 2]
  const change =
    previous.revenue > 0
      ? (current.revenue - previous.revenue) / previous.revenue
      : current.revenue > 0
        ? 1
        : 0

  return c.json({
    range: { from, to },
    totals: {
      /** Money actually collected — rows in `payments`. */
      revenue: totalRevenue,
      /** What the bookings in this range are worth, paid or not. */
      accrued: accruedRow?.accrued ?? 0,
      /** Still owed across those bookings (deposits excluded). */
      outstanding: accruedRow?.outstanding ?? 0,
      bookings: accruedRow?.bookings ?? 0,
      paid_bookings: byType.reduce((sum, r) => sum + r.bookings, 0),
      payments: byType.reduce((sum, r) => sum + r.payments, 0),
    },
    by_type: byType,
    by_category: byCategory,
    occupancy: {
      nights_sold: nightsSold,
      nights_available: nightsAvailable,
      rate: occupancyRate,
      rooms: roomCount?.count ?? 0,
    },
    months,
    month_over_month: {
      current: { month: current.month, revenue: current.revenue },
      previous: { month: previous.month, revenue: previous.revenue },
      change,
    },
  })
})

/**
 * GET /api/analytics/payments?from=&to= — every individual payment in the
 * range, for handing to an accountant.
 *
 * Distinct from the summary: that aggregates, this is the underlying ledger
 * line by line, in the order the money arrived, with a running total so the
 * final row can be reconciled against the summary's revenue figure.
 */
analytics.get('/payments', async (c) => {
  const today = await c.env.DB.prepare(`SELECT ${SQL_TODAY} AS today`).first<{ today: string }>()
  const defaultTo = today?.today ?? new Date().toISOString().slice(0, 10)
  const from = c.req.query('from') ?? `${defaultTo.slice(0, 7)}-01`
  const to = c.req.query('to') ?? defaultTo

  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new HTTPException(400, { message: 'from and to must be YYYY-MM-DD dates' })
  }
  if (to < from) {
    throw new HTTPException(400, { message: 'to must not be earlier than from' })
  }

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.paid_at, p.amount, p.method, p.group_id,
            b.id AS booking_id, b.guest_name, b.guest_phone, b.currency,
            b.date_from, b.date_to,
            u.name AS unit_name, u.type AS unit_type
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN units u ON u.id = b.unit_id
     WHERE date(p.paid_at) BETWEEN date(?) AND date(?)
     ORDER BY p.paid_at, p.id`
  )
    .bind(from, to)
    .all<{
      id: number
      paid_at: string
      amount: number
      method: string
      group_id: number | null
      booking_id: number
      guest_name: string
      guest_phone: string | null
      currency: string
      date_from: string
      date_to: string
      unit_name: string
      unit_type: UnitType
    }>()

  let running = 0
  const rows = results.map((row) => {
    running = Number((running + row.amount).toFixed(2))
    return { ...row, running_total: running }
  })

  const byMethod: Record<string, number> = {}
  for (const row of results) {
    byMethod[row.method] = Number(((byMethod[row.method] ?? 0) + row.amount).toFixed(2))
  }

  return c.json({
    range: { from, to },
    count: rows.length,
    total: running,
    by_method: byMethod,
    payments: rows,
  })
})

export default analytics