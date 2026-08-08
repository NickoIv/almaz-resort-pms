import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed, canSeeMoney, placeholders, resolveTypeFilter } from '../lib/access'
import { SQL_COVERS_NOW, SQL_STARTS_LATER } from '../lib/time'
import type { AppEnv, BookingStatus, UnitType } from '../types'

type UnitRow = {
  id: number
  type: UnitType
  name: string
  category: string | null
  capacity: number
  cleaning_pending: number
  cleaning_total: number
  booking_id: number | null
  guest_name: string | null
  guest_phone: string | null
  date_from: string | null
  date_to: string | null
  booking_status: BookingStatus | null
  total_amount: number | null
  prepaid_amount: number | null
  deposit_amount: number | null
  currency: string | null
  next_booking_id: number | null
  next_date_from: string | null
  next_date_to: string | null
  next_guest_name: string | null
}

const UNIT_SELECT = `
  SELECT
    u.id, u.type, u.name, u.category, u.capacity,
    (SELECT COUNT(*) FROM cleaning_checklist cc WHERE cc.unit_id = u.id AND cc.is_done = 0) AS cleaning_pending,
    (SELECT COUNT(*) FROM cleaning_checklist cc WHERE cc.unit_id = u.id) AS cleaning_total,
    b.id AS booking_id, b.guest_name, b.guest_phone, b.date_from, b.date_to,
    b.status AS booking_status, b.total_amount, b.prepaid_amount, b.deposit_amount, b.currency,
    nb.id AS next_booking_id, nb.date_from AS next_date_from, nb.date_to AS next_date_to,
    nb.guest_name AS next_guest_name
  FROM units u
  LEFT JOIN bookings b ON b.id = (
    SELECT id FROM bookings
    WHERE unit_id = u.id AND status <> 'free' AND ${SQL_COVERS_NOW}
    ORDER BY (status = 'occupied') DESC, date_from DESC
    LIMIT 1
  )
  LEFT JOIN bookings nb ON nb.id = (
    SELECT id FROM bookings
    WHERE unit_id = u.id AND status <> 'free' AND ${SQL_STARTS_LATER}
    ORDER BY date_from ASC
    LIMIT 1
  )
`

/**
 * Shapes a row for the client, hiding money from non-admin roles.
 * `is_paid` is the one exception: a waiter has to know whether a guest still
 * owes anything, so the flag is shared even though the amounts are not.
 */
function serializeUnit(row: UnitRow, withMoney: boolean) {
  const current = row.booking_id
    ? {
        id: row.booking_id,
        guest_name: row.guest_name,
        guest_phone: row.guest_phone,
        date_from: row.date_from,
        date_to: row.date_to,
        status: row.booking_status,
        is_paid: (row.total_amount ?? 0) - (row.prepaid_amount ?? 0) <= 0,
        ...(withMoney
          ? {
              total_amount: row.total_amount ?? 0,
              prepaid_amount: row.prepaid_amount ?? 0,
              deposit_amount: row.deposit_amount ?? 0,
              remaining_amount: (row.total_amount ?? 0) - (row.prepaid_amount ?? 0),
              currency: row.currency ?? 'KZT',
            }
          : {}),
      }
    : null

  return {
    id: row.id,
    type: row.type,
    name: row.name,
    category: row.category,
    capacity: row.capacity,
    status: (row.booking_status ?? 'free') as BookingStatus,
    needs_cleaning: row.cleaning_pending > 0,
    cleaning_pending: row.cleaning_pending,
    cleaning_total: row.cleaning_total,
    current_booking: current,
    next_booking: row.next_booking_id
      ? {
          id: row.next_booking_id,
          guest_name: row.next_guest_name,
          date_from: row.next_date_from,
          date_to: row.next_date_to,
        }
      : null,
  }
}

const units = new Hono<AppEnv>()

/** GET /api/units?type=room — list units with today's status. */
units.get('/', async (c) => {
  const staff = c.get('staff')
  const types = resolveTypeFilter(staff.role, c.req.query('type'))

  const { results } = await c.env.DB.prepare(
    `${UNIT_SELECT} WHERE u.type IN (${placeholders(types.length)}) ORDER BY u.type, u.name`
  )
    .bind(...types)
    .all<UnitRow>()

  const withMoney = canSeeMoney(staff.role)
  return c.json(results.map((row) => serializeUnit(row, withMoney)))
})

/** GET /api/units/:id */
units.get('/:id', async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid unit id' })

  const row = await c.env.DB.prepare(`${UNIT_SELECT} WHERE u.id = ?`).bind(id).first<UnitRow>()
  if (!row) throw new HTTPException(404, { message: 'Unit not found' })
  assertUnitTypeAllowed(staff.role, row.type)

  return c.json(serializeUnit(row, canSeeMoney(staff.role)))
})

type CalendarBookingRow = {
  id: number
  guest_name: string
  guest_phone: string | null
  date_from: string
  date_to: string
  status: BookingStatus
  total_amount: number
  prepaid_amount: number
  deposit_amount: number
  currency: string
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * GET /api/units/:id/calendar?month=YYYY-MM
 * Returns one entry per day of the month with the status that colours it.
 */
units.get('/:id/calendar', async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid unit id' })

  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new HTTPException(400, { message: 'month must be in YYYY-MM format' })
  }

  const unit = await c.env.DB.prepare('SELECT id, type, name FROM units WHERE id = ?')
    .bind(id)
    .first<{ id: number; type: UnitType; name: string }>()
  if (!unit) throw new HTTPException(404, { message: 'Unit not found' })
  assertUnitTypeAllowed(staff.role, unit.type)

  const [yearRaw, monthRaw] = month.split('-')
  const year = Number(yearRaw)
  const monthIndex = Number(monthRaw)
  const total = daysInMonth(year, monthIndex)
  const first = isoDay(year, monthIndex, 1)
  const last = isoDay(year, monthIndex, total)

  const { results } = await c.env.DB.prepare(
    `SELECT id, guest_name, guest_phone, date_from, date_to, status,
            total_amount, prepaid_amount, deposit_amount, currency
     FROM bookings
     WHERE unit_id = ? AND status <> 'free'
       AND date(date_from) <= date(?) AND date(date_to) >= date(?)
     ORDER BY date_from`
  )
    .bind(id, last, first)
    .all<CalendarBookingRow>()

  const withMoney = canSeeMoney(staff.role)

  const days = Array.from({ length: total }, (_, index) => {
    const date = isoDay(year, monthIndex, index + 1)
    const booking = results.find(
      (b) => b.date_from.slice(0, 10) <= date && b.date_to.slice(0, 10) >= date
    )
    return {
      date,
      status: (booking?.status ?? 'free') as BookingStatus,
      booking_id: booking?.id ?? null,
      guest_name: booking?.guest_name ?? null,
    }
  })

  return c.json({
    unit: { id: unit.id, name: unit.name, type: unit.type },
    month,
    days,
    bookings: results.map((b) => ({
      id: b.id,
      guest_name: b.guest_name,
      guest_phone: b.guest_phone,
      date_from: b.date_from,
      date_to: b.date_to,
      status: b.status,
      ...(withMoney
        ? {
            total_amount: b.total_amount,
            prepaid_amount: b.prepaid_amount,
            deposit_amount: b.deposit_amount,
            remaining_amount: b.total_amount - b.prepaid_amount,
            currency: b.currency,
          }
        : {}),
    })),
  })
})

export default units