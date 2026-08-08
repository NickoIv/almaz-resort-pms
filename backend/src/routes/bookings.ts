import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed, canSeeMoney } from '../lib/access'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { resetChecklist } from '../lib/cleaning'
import { writeAudit } from '../lib/audit'
import { addHours, almatyNow } from '../lib/time'
import type { AppEnv, BookingStatus, UnitType } from '../types'

type BookingRow = {
  id: number
  unit_id: number
  guest_name: string
  guest_phone: string | null
  date_from: string
  date_to: string
  status: BookingStatus
  total_amount: number
  prepaid_amount: number
  deposit_amount: number
  currency: string
  created_at: string
}

const BOOKING_STATUSES: BookingStatus[] = ['free', 'booked', 'occupied']

function serializeBooking(row: BookingRow, withMoney: boolean) {
  return {
    id: row.id,
    unit_id: row.unit_id,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    date_from: row.date_from,
    date_to: row.date_to,
    status: row.status,
    created_at: row.created_at,
    is_paid: row.total_amount - row.prepaid_amount <= 0,
    ...(withMoney
      ? {
          total_amount: row.total_amount,
          prepaid_amount: row.prepaid_amount,
          deposit_amount: row.deposit_amount,
          remaining_amount: row.total_amount - row.prepaid_amount,
          currency: row.currency,
        }
      : {}),
  }
}

async function loadUnit(db: D1Database, unitId: number) {
  const unit = await db
    .prepare('SELECT id, type, name FROM units WHERE id = ?')
    .bind(unitId)
    .first<{ id: number; type: UnitType; name: string }>()
  if (!unit) throw new HTTPException(404, { message: 'Unit not found' })
  return unit
}

/** Rejects a booking that overlaps an existing one on the same unit. */
async function assertNoOverlap(
  db: D1Database,
  unitId: number,
  dateFrom: string,
  dateTo: string,
  ignoreBookingId: number | null
): Promise<void> {
  const clash = await db
    .prepare(
      `SELECT id FROM bookings
       WHERE unit_id = ? AND status <> 'free' AND id <> ?
         AND datetime(date_from) < datetime(?) AND datetime(date_to) > datetime(?)
       LIMIT 1`
    )
    .bind(unitId, ignoreBookingId ?? -1, dateTo, dateFrom)
    .first<{ id: number }>()

  if (clash) {
    throw new HTTPException(409, {
      message: `Даты пересекаются с бронью #${clash.id}`,
    })
  }
}

const bookings = new Hono<AppEnv>()

// Housekeepers never touch bookings — only admins and waiters do, and the
// unit-type check below keeps waiters inside the restaurant area.
const canBook = requireRole('admin', 'waiter')

/** GET /api/bookings?unit_id=&from=&to= */
bookings.get('/', async (c) => {
  const staff = c.get('staff')
  const unitId = Number(c.req.query('unit_id'))
  if (!Number.isInteger(unitId)) {
    throw new HTTPException(400, { message: 'unit_id query parameter is required' })
  }

  const unit = await loadUnit(c.env.DB, unitId)
  assertUnitTypeAllowed(staff.role, unit.type)

  const from = c.req.query('from') ?? '0000-01-01'
  const to = c.req.query('to') ?? '9999-12-31'

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM bookings
     WHERE unit_id = ? AND date(date_to) >= date(?) AND date(date_from) <= date(?)
     ORDER BY date_from DESC`
  )
    .bind(unitId, from, to)
    .all<BookingRow>()

  const withMoney = canSeeMoney(staff.role)
  return c.json(results.map((row) => serializeBooking(row, withMoney)))
})

/** POST /api/bookings */
bookings.post('/', canBook, async (c) => {
  const staff = c.get('staff')
  const body = await readJson(c)

  const unitId = Number(body.unit_id)
  const guestName = String(body.guest_name ?? '').trim()
  const dateFrom = String(body.date_from ?? '').trim()
  const dateTo = String(body.date_to ?? '').trim()

  if (!Number.isInteger(unitId) || !guestName || !dateFrom || !dateTo) {
    throw new HTTPException(400, {
      message: 'unit_id, guest_name, date_from and date_to are required',
    })
  }
  if (dateTo < dateFrom) {
    throw new HTTPException(400, { message: 'date_to must not be earlier than date_from' })
  }

  const unit = await loadUnit(c.env.DB, unitId)
  assertUnitTypeAllowed(staff.role, unit.type)

  const status = (body.status as BookingStatus) ?? 'booked'
  if (!BOOKING_STATUSES.includes(status)) {
    throw new HTTPException(400, { message: 'Invalid booking status' })
  }

  await assertNoOverlap(c.env.DB, unitId, dateFrom, dateTo, null)

  // Waiters take bookings but do not set prices; admins may.
  const money = canSeeMoney(staff.role)
  const total = money ? Number(body.total_amount ?? 0) : 0
  const prepaid = money ? Number(body.prepaid_amount ?? 0) : 0
  const deposit = money ? Number(body.deposit_amount ?? 0) : 0

  const created = await c.env.DB.prepare(
    `INSERT INTO bookings
       (unit_id, guest_name, guest_phone, date_from, date_to, status,
        total_amount, prepaid_amount, deposit_amount, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      unitId,
      guestName,
      body.guest_phone ? String(body.guest_phone) : null,
      dateFrom,
      dateTo,
      status,
      total,
      prepaid,
      deposit,
      String(body.currency ?? 'KZT')
    )
    .first<BookingRow>()

  if (!created) throw new HTTPException(500, { message: 'Failed to create booking' })

  await writeAudit(c.env.DB, staff.sub, 'booking.create', 'bookings', created.id)
  return c.json(serializeBooking(created, money), 201)
})

/**
 * POST /api/bookings/quick — a waiter seats a guest on the spot.
 * Only a guest name and a duration in hours; the server fills in the times.
 * Restaurant/recreation units only — rooms are booked by night.
 */
bookings.post('/quick', canBook, async (c) => {
  const staff = c.get('staff')
  const body = await readJson(c)

  const unitId = Number(body.unit_id)
  const guestName = String(body.guest_name ?? '').trim()
  const hours = Number(body.hours ?? 0)

  if (!Number.isInteger(unitId) || !guestName) {
    throw new HTTPException(400, { message: 'unit_id and guest_name are required' })
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new HTTPException(400, { message: 'hours must be between 1 and 24' })
  }

  const unit = await loadUnit(c.env.DB, unitId)
  assertUnitTypeAllowed(staff.role, unit.type)
  if (unit.type === 'room') {
    throw new HTTPException(400, { message: 'Быстрое бронирование доступно только для зоны отдыха' })
  }

  const dateFrom = almatyNow()
  const dateTo = addHours(dateFrom, hours)

  await assertNoOverlap(c.env.DB, unitId, dateFrom, dateTo, null)

  const created = await c.env.DB.prepare(
    `INSERT INTO bookings
       (unit_id, guest_name, guest_phone, date_from, date_to, status, currency)
     VALUES (?, ?, ?, ?, ?, 'occupied', 'KZT')
     RETURNING *`
  )
    .bind(unitId, guestName, body.guest_phone ? String(body.guest_phone) : null, dateFrom, dateTo)
    .first<BookingRow>()

  if (!created) throw new HTTPException(500, { message: 'Failed to create booking' })

  await writeAudit(c.env.DB, staff.sub, 'booking.quick', 'bookings', created.id)
  return c.json(serializeBooking(created, canSeeMoney(staff.role)), 201)
})

/** PATCH /api/bookings/:id — dates, guest details, status. */
bookings.patch('/:id', canBook, async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const existing = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?')
    .bind(id)
    .first<BookingRow>()
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' })

  const unit = await loadUnit(c.env.DB, existing.unit_id)
  assertUnitTypeAllowed(staff.role, unit.type)

  const body = await readJson(c)

  const guestName = body.guest_name === undefined ? existing.guest_name : String(body.guest_name)
  const guestPhone =
    body.guest_phone === undefined
      ? existing.guest_phone
      : body.guest_phone === null
        ? null
        : String(body.guest_phone)
  const dateFrom = body.date_from === undefined ? existing.date_from : String(body.date_from)
  const dateTo = body.date_to === undefined ? existing.date_to : String(body.date_to)
  const status = (body.status === undefined ? existing.status : body.status) as BookingStatus

  if (!BOOKING_STATUSES.includes(status)) {
    throw new HTTPException(400, { message: 'Invalid booking status' })
  }
  if (dateTo < dateFrom) {
    throw new HTTPException(400, { message: 'date_to must not be earlier than date_from' })
  }
  if (status !== 'free') {
    await assertNoOverlap(c.env.DB, existing.unit_id, dateFrom, dateTo, id)
  }

  const updated = await c.env.DB.prepare(
    `UPDATE bookings
     SET guest_name = ?, guest_phone = ?, date_from = ?, date_to = ?, status = ?
     WHERE id = ?
     RETURNING *`
  )
    .bind(guestName, guestPhone, dateFrom, dateTo, status, id)
    .first<BookingRow>()

  if (!updated) throw new HTTPException(500, { message: 'Failed to update booking' })

  // Checking out queues the unit for housekeeping.
  if (existing.status !== 'free' && status === 'free') {
    await resetChecklist(c.env.DB, existing.unit_id, unit.type, id)
  }

  await writeAudit(c.env.DB, staff.sub, `booking.update:${status}`, 'bookings', id)
  return c.json(serializeBooking(updated, canSeeMoney(staff.role)))
})

/** PATCH /api/bookings/:id/payment — admin only. */
bookings.patch('/:id/payment', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const existing = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?')
    .bind(id)
    .first<BookingRow>()
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' })

  const body = await readJson(c)

  const total = body.total_amount === undefined ? existing.total_amount : Number(body.total_amount)
  const deposit =
    body.deposit_amount === undefined ? existing.deposit_amount : Number(body.deposit_amount)
  const currency = body.currency === undefined ? existing.currency : String(body.currency)

  // A `payment` block records a new instalment and adds it to the prepaid total;
  // `prepaid_amount` sets the figure outright (a correction).
  const payment = body.payment as { amount?: unknown; method?: unknown } | undefined
  const paymentAmount = payment ? Number(payment.amount ?? 0) : 0

  let prepaid =
    body.prepaid_amount === undefined ? existing.prepaid_amount : Number(body.prepaid_amount)
  if (paymentAmount > 0) prepaid += paymentAmount

  if ([total, deposit, prepaid].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new HTTPException(400, { message: 'Amounts must be non-negative numbers' })
  }

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'UPDATE bookings SET total_amount = ?, prepaid_amount = ?, deposit_amount = ?, currency = ? WHERE id = ?'
    ).bind(total, prepaid, deposit, currency, id),
  ]
  if (paymentAmount > 0) {
    statements.push(
      c.env.DB.prepare('INSERT INTO payments (booking_id, amount, method) VALUES (?, ?, ?)').bind(
        id,
        paymentAmount,
        String(payment?.method ?? 'cash')
      )
    )
  }
  await c.env.DB.batch(statements)

  const updated = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?')
    .bind(id)
    .first<BookingRow>()

  await writeAudit(c.env.DB, staff.sub, 'booking.payment', 'bookings', id)
  return c.json(serializeBooking(updated!, true))
})

/** GET /api/bookings/:id/payments — admin only. */
bookings.get('/:id/payments', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const { results } = await c.env.DB.prepare(
    'SELECT id, booking_id, amount, method, paid_at FROM payments WHERE booking_id = ? ORDER BY paid_at DESC'
  )
    .bind(id)
    .all()

  return c.json(results)
})

export default bookings