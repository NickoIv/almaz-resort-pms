import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed, canSeeMoney, placeholders, resolveTypeFilter } from '../lib/access'
import { chargesSumSql, remainingOf } from '../lib/money'
import { SQL_COVERS_NOW, SQL_STARTS_LATER, SQL_TODAY } from '../lib/time'
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
  group_id: number | null
  charges_total: number | null
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
    b.group_id, ${chargesSumSql('b')} AS charges_total,
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
        group_id: row.group_id,
        is_paid:
          remainingOf(row.total_amount ?? 0, row.charges_total ?? 0, row.prepaid_amount ?? 0) <= 0,
        ...(withMoney
          ? {
              total_amount: row.total_amount ?? 0,
              prepaid_amount: row.prepaid_amount ?? 0,
              // Refundable hold — reported alongside the balance, never inside it.
              deposit_amount: row.deposit_amount ?? 0,
              charges_amount: row.charges_total ?? 0,
              remaining_amount: remainingOf(
                row.total_amount ?? 0,
                row.charges_total ?? 0,
                row.prepaid_amount ?? 0
              ),
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

/**
 * GET /api/units/forecast?days=14&type=room — free vs taken per day ahead.
 *
 * For answering a phone call: "do you have anything on Friday?". Counts what
 * is already booked, nothing predictive. A night is occupied when a booking
 * covers it, with checkout day free again — the same rule `occupiesDay` below
 * applies to the month grid, so the two can never disagree.
 */
units.get('/forecast', async (c) => {
  const staff = c.get('staff')
  const types = resolveTypeFilter(staff.role, c.req.query('type') ?? 'room')

  const requested = Number(c.req.query('days') ?? 14)
  const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 14, 1), 60)

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM units WHERE type IN (${placeholders(types.length)})`
  )
    .bind(...types)
    .first<{ count: number }>()
  const total = totalRow?.count ?? 0

  const { results } = await c.env.DB.prepare(
    `WITH RECURSIVE span(d) AS (
       SELECT ${SQL_TODAY}
       UNION ALL
       SELECT date(d, '+1 day') FROM span WHERE d < date(${SQL_TODAY}, '+' || ? || ' days')
     )
     SELECT d AS date,
            (SELECT COUNT(*)
             FROM bookings b JOIN units u ON u.id = b.unit_id
             WHERE u.type IN (${placeholders(types.length)})
               AND b.status <> 'free'
               AND date(b.date_from) <= d AND date(b.date_to) > d
            ) AS taken
     FROM span
     ORDER BY d`
  )
    .bind(days - 1, ...types)
    .all<{ date: string; taken: number }>()

  return c.json({
    total_units: total,
    days: results.map((row) => ({
      date: row.date,
      taken: row.taken,
      free: Math.max(0, total - row.taken),
      occupancy_rate: total > 0 ? row.taken / total : 0,
    })),
  })
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
  charges_total: number
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Does this booking take up the given day?
 *
 * The end is **exclusive**, which is the same rule `assertNoOverlap` enforces
 * and the same one the planning board draws: a stay of 15→18 occupies the
 * nights of the 15th, 16th and 17th, and the room is free again on the morning
 * of the 18th. The month grid used `date_to >= day` and so shaded the checkout
 * day busy — every stay looked a day longer than it was, and a day that could
 * be sold, and *was* sellable through the booking form, looked taken.
 *
 * Plain string comparison gives exactly the datetime semantics, because ISO
 * strings sort correctly and a bare date is a prefix of a datetime. That is what
 * keeps hourly units right: a gazebo booked 15th 13:00 → 15th 18:00 has
 * `date_to` of `2027-03-15 18:00`, which is greater than `2027-03-15`, so its
 * one day stays occupied. An exclusive rule applied to dates alone would have
 * emptied the restaurant calendar completely.
 */
function occupiesDay(booking: { date_from: string; date_to: string }, day: string): boolean {
  return booking.date_from.slice(0, 10) <= day && booking.date_to > day
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
    `SELECT b.id, b.guest_name, b.guest_phone, b.date_from, b.date_to, b.status,
            b.total_amount, b.prepaid_amount, b.deposit_amount, b.currency,
            ${chargesSumSql('b')} AS charges_total
     FROM bookings b
     WHERE unit_id = ? AND status <> 'free'
       AND date(date_from) <= date(?) AND date_to > ?
     ORDER BY date_from`
  )
    .bind(id, last, first)
    .all<CalendarBookingRow>()

  const withMoney = canSeeMoney(staff.role)

  const days = Array.from({ length: total }, (_, index) => {
    const date = isoDay(year, monthIndex, index + 1)
    // With the end exclusive, a turnover day matches only the arriving booking,
    // so the name on the cell is the guest who is actually in the room that
    // night rather than the one who left that morning.
    const booking = results.find((b) => occupiesDay(b, date))
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
            charges_amount: b.charges_total,
            remaining_amount: remainingOf(b.total_amount, b.charges_total, b.prepaid_amount),
            currency: b.currency,
          }
        : {}),
    })),
  })
})

export default units