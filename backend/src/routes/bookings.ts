import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed, canSeeMoney } from '../lib/access'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { resetChecklist } from '../lib/cleaning'
import { writeAudit } from '../lib/audit'
import { chargesSumSql, remainingOf } from '../lib/money'
import { cleanName, cleanOptional } from '../lib/text'
import { CANCEL_REASONS, isCancelReason } from '../lib/cancellation'
import { findWaitlistMatches } from './waitlist'
import { addHours, almatyNow, SQL_NOW } from '../lib/time'
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
  group_id: number | null
  charges_total?: number
  cancel_reason: string | null
  cancel_note: string | null
  cancelled_at: string | null
}

const BOOKING_STATUSES: BookingStatus[] = ['free', 'booked', 'occupied']

/** Always read bookings through this so the extra-charge total comes with them. */
const BOOKING_SELECT = `SELECT b.*, ${chargesSumSql('b')} AS charges_total FROM bookings b`

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
    group_id: row.group_id,
    cancel_reason: row.cancel_reason,
    cancel_note: row.cancel_note,
    cancelled_at: row.cancelled_at,
    is_paid: remainingOf(row.total_amount, row.charges_total ?? 0, row.prepaid_amount) <= 0,
    ...(withMoney
      ? {
          total_amount: row.total_amount,
          prepaid_amount: row.prepaid_amount,
          deposit_amount: row.deposit_amount,
          charges_amount: row.charges_total ?? 0,
          remaining_amount: remainingOf(row.total_amount, row.charges_total ?? 0, row.prepaid_amount),
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
    `${BOOKING_SELECT}
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
  const guestName = cleanName(body.guest_name)
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
        total_amount, prepaid_amount, deposit_amount, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})
     RETURNING *`
  )
    .bind(
      unitId,
      guestName,
      cleanOptional(body.guest_phone, 40),
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

  // `payments` is the ledger analytics reads; an upfront prepayment has to land
  // there too, or the money is invisible to every revenue report.
  if (prepaid > 0) {
    await c.env.DB.prepare(
      `INSERT INTO payments (booking_id, amount, method, paid_at) VALUES (?, ?, ?, ${SQL_NOW})`
    )
      .bind(created.id, prepaid, String(body.payment_method ?? 'cash'))
      .run()
  }

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
  const guestName = cleanName(body.guest_name)
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
       (unit_id, guest_name, guest_phone, date_from, date_to, status, currency, created_at)
     VALUES (?, ?, ?, ?, ?, 'occupied', ?, ${SQL_NOW})
     RETURNING *`
  )
    .bind(
      unitId,
      guestName,
      cleanOptional(body.guest_phone, 40),
      dateFrom,
      dateTo,
      String(body.currency ?? 'KZT')
    )
    .first<BookingRow>()

  if (!created) throw new HTTPException(500, { message: 'Failed to create booking' })

  await writeAudit(c.env.DB, staff.sub, 'booking.quick', 'bookings', created.id)
  return c.json(serializeBooking(created, canSeeMoney(staff.role)), 201)
})

/**
 * POST /api/bookings/group — one event reserving several units at once.
 *
 * Each unit still gets its own booking row (so availability, calendars and
 * cleaning keep working untouched); `booking_groups` ties them together. The
 * event price is split evenly across the units, with any rounding remainder
 * going to the first, so the parts always add back up to the quoted total.
 */
bookings.post('/group', canBook, async (c) => {
  const staff = c.get('staff')
  const body = await readJson(c)

  const unitIds = Array.isArray(body.unit_ids) ? body.unit_ids.map(Number) : []
  const name = cleanName(body.name)
  const guestName = cleanName(body.guest_name)
  const dateFrom = String(body.date_from ?? '').trim()
  const dateTo = String(body.date_to ?? '').trim()

  if (unitIds.length < 2 || unitIds.some((id) => !Number.isInteger(id))) {
    throw new HTTPException(400, { message: 'Выберите минимум два объекта для групповой брони' })
  }
  if (!name || !guestName || !dateFrom || !dateTo) {
    throw new HTTPException(400, {
      message: 'name, guest_name, date_from и date_to обязательны',
    })
  }
  if (dateTo < dateFrom) {
    throw new HTTPException(400, { message: 'date_to must not be earlier than date_from' })
  }

  const unique = [...new Set(unitIds)]
  if (unique.length !== unitIds.length) {
    throw new HTTPException(400, { message: 'Один и тот же объект указан несколько раз' })
  }

  // Validate every unit before writing anything — a group booking is
  // all-or-nothing, so a single clash must not leave half a group behind.
  const units = []
  for (const unitId of unique) {
    const unit = await loadUnit(c.env.DB, unitId)
    assertUnitTypeAllowed(staff.role, unit.type)
    await assertNoOverlap(c.env.DB, unitId, dateFrom, dateTo, null)
    units.push(unit)
  }

  const money = canSeeMoney(staff.role)
  const total = money ? Number(body.total_amount ?? 0) : 0
  const deposit = money ? Number(body.deposit_amount ?? 0) : 0
  if (![total, deposit].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new HTTPException(400, { message: 'Суммы должны быть неотрицательными числами' })
  }

  const status = (body.status as BookingStatus) ?? 'booked'
  if (!BOOKING_STATUSES.includes(status)) {
    throw new HTTPException(400, { message: 'Invalid booking status' })
  }

  const group = await c.env.DB.prepare(
    `INSERT INTO booking_groups (name, guest_name, guest_phone, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ${SQL_NOW}) RETURNING *`
  )
    .bind(
      name,
      guestName,
      cleanOptional(body.guest_phone, 40),
      body.note ? String(body.note) : null,
      staff.sub
    )
    .first<{ id: number }>()

  if (!group) throw new HTTPException(500, { message: 'Failed to create booking group' })

  // Split in whole currency units — KZT has no subunit in practice, so a
  // per-room price of 33333.33 would just read as a rounding artefact.
  const share = Math.floor(total / units.length)
  const depositShare = Math.floor(deposit / units.length)

  const created: BookingRow[] = []
  for (const [index, unit] of units.entries()) {
    // The first unit absorbs the rounding remainder.
    const unitTotal = index === 0 ? Number((total - share * (units.length - 1)).toFixed(2)) : share
    const unitDeposit =
      index === 0 ? Number((deposit - depositShare * (units.length - 1)).toFixed(2)) : depositShare

    const row = await c.env.DB.prepare(
      `INSERT INTO bookings
         (unit_id, guest_name, guest_phone, date_from, date_to, status,
          total_amount, prepaid_amount, deposit_amount, currency, group_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ${SQL_NOW})
       RETURNING *`
    )
      .bind(
        unit.id,
        guestName,
        cleanOptional(body.guest_phone, 40),
        dateFrom,
        dateTo,
        status,
        unitTotal,
        unitDeposit,
        String(body.currency ?? 'KZT'),
        group.id
      )
      .first<BookingRow>()

    if (row) created.push(row)
  }

  await writeAudit(c.env.DB, staff.sub, 'booking.group.create', 'booking_groups', group.id)

  return c.json(
    {
      group: { id: group.id, name, guest_name: guestName, units: created.length },
      bookings: created.map((row) => serializeBooking(row, money)),
    },
    201
  )
})

/** GET /api/bookings/group/:groupId — the event and every unit on it. */
bookings.get('/group/:groupId', requireRole('admin'), async (c) => {
  const groupId = Number(c.req.param('groupId'))
  if (!Number.isInteger(groupId)) throw new HTTPException(400, { message: 'Invalid group id' })

  const group = await c.env.DB.prepare('SELECT * FROM booking_groups WHERE id = ?')
    .bind(groupId)
    .first()
  if (!group) throw new HTTPException(404, { message: 'Группа не найдена' })

  const { results } = await c.env.DB.prepare(
    `${BOOKING_SELECT} WHERE b.group_id = ? ORDER BY b.id`
  )
    .bind(groupId)
    .all<BookingRow>()

  const { results: unitRows } = await c.env.DB.prepare(
    `SELECT b.id AS booking_id, u.name, u.type FROM bookings b
     JOIN units u ON u.id = b.unit_id WHERE b.group_id = ? ORDER BY b.id`
  )
    .bind(groupId)
    .all<{ booking_id: number; name: string; type: UnitType }>()

  const names = new Map(unitRows.map((row) => [row.booking_id, row]))

  return c.json({
    group,
    bookings: results.map((row) => ({
      ...serializeBooking(row, true),
      unit_name: names.get(row.id)?.name ?? null,
      unit_type: names.get(row.id)?.type ?? null,
    })),
  })
})

/**
 * PATCH /api/bookings/group/:groupId/payment — one combined instalment.
 *
 * The ledger stays per-booking (analytics joins payments through to a unit
 * type), so the amount is allocated across the group's bookings in proportion
 * to what each still owes. Every resulting row shares the same `group_id`, so
 * the UI can present it back as the single payment the guest actually made.
 */
bookings.patch('/group/:groupId/payment', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const groupId = Number(c.req.param('groupId'))
  if (!Number.isInteger(groupId)) throw new HTTPException(400, { message: 'Invalid group id' })

  const body = await readJson(c)
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HTTPException(400, { message: 'Сумма оплаты должна быть больше нуля' })
  }
  const method = String(body.method ?? 'cash')

  const { results: groupBookings } = await c.env.DB.prepare(
    `${BOOKING_SELECT} WHERE b.group_id = ? ORDER BY b.id`
  )
    .bind(groupId)
    .all<BookingRow>()

  if (groupBookings.length === 0) {
    throw new HTTPException(404, { message: 'В группе нет броней' })
  }

  const owed = groupBookings.map((row) =>
    Math.max(0, remainingOf(row.total_amount, row.charges_total ?? 0, row.prepaid_amount))
  )
  const totalOwed = owed.reduce((sum, value) => sum + value, 0)

  // Nothing outstanding (or an overpayment): fall back to an even split.
  const weights =
    totalOwed > 0 ? owed.map((value) => value / totalOwed) : groupBookings.map(() => 1 / groupBookings.length)

  // Allocate in whole currency units — KZT has no subunit in practice, and a
  // ledger full of fractional tenge reads like a bug. The first booking absorbs
  // whatever is left over, so the parts always add back up to what was paid.
  const allocations = weights.map((weight) => Math.floor(amount * weight))
  const allocated = allocations.reduce((sum, value) => sum + value, 0)
  allocations[0] = Number((allocations[0] + (amount - allocated)).toFixed(2))

  const statements: D1PreparedStatement[] = []
  groupBookings.forEach((row, index) => {
    const part = allocations[index]
    if (part === 0) return
    statements.push(
      c.env.DB.prepare('UPDATE bookings SET prepaid_amount = prepaid_amount + ? WHERE id = ?').bind(
        part,
        row.id
      )
    )
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO payments (booking_id, amount, method, group_id, paid_at)
         VALUES (?, ?, ?, ?, ${SQL_NOW})`
      ).bind(row.id, part, method, groupId)
    )
  })

  await c.env.DB.batch(statements)
  await writeAudit(c.env.DB, staff.sub, 'booking.group.payment', 'booking_groups', groupId)

  return c.json({
    group_id: groupId,
    amount,
    method,
    allocated_across: statements.length / 2,
    allocations: groupBookings.map((row, index) => ({
      booking_id: row.id,
      amount: allocations[index],
    })),
  })
})

/** PATCH /api/bookings/:id — dates, guest details, status. */
bookings.patch('/:id', canBook, async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const existing = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' })

  const unit = await loadUnit(c.env.DB, existing.unit_id)
  assertUnitTypeAllowed(staff.role, unit.type)

  const body = await readJson(c)

  const guestName =
    body.guest_name === undefined ? existing.guest_name : cleanName(body.guest_name)
  const guestPhone =
    body.guest_phone === undefined ? existing.guest_phone : cleanOptional(body.guest_phone, 40)
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

  // Going from booked/occupied to free is either a checkout or a cancellation.
  // The reason is what distinguishes them afterwards, so it is required on
  // that transition and recorded on the booking itself.
  const ending = existing.status !== 'free' && status === 'free'
  let cancelReason = existing.cancel_reason
  let cancelNote = existing.cancel_note

  if (ending) {
    if (!isCancelReason(body.cancel_reason)) {
      throw new HTTPException(400, {
        message: `Укажите причину: ${CANCEL_REASONS.join(', ')}`,
      })
    }
    cancelReason = body.cancel_reason
    cancelNote = cleanOptional(body.cancel_note, 300)
    if (cancelReason === 'other' && !cancelNote) {
      throw new HTTPException(400, { message: 'Для причины «Другое» опишите её текстом' })
    }
  }

  const updated = await c.env.DB.prepare(
    `UPDATE bookings
     SET guest_name = ?, guest_phone = ?, date_from = ?, date_to = ?, status = ?,
         cancel_reason = ?, cancel_note = ?,
         cancelled_at = CASE WHEN ? THEN ${SQL_NOW} ELSE cancelled_at END
     WHERE id = ?
     RETURNING *`
  )
    .bind(
      guestName,
      guestPhone,
      dateFrom,
      dateTo,
      status,
      cancelReason,
      cancelNote,
      ending ? 1 : 0,
      id
    )
    .first<BookingRow>()

  if (!updated) throw new HTTPException(500, { message: 'Failed to update booking' })

  // Checking out queues the unit for housekeeping.
  if (ending) {
    await resetChecklist(c.env.DB, existing.unit_id, unit.type, id)
  }

  // The reason rides in the audit action so the journal reads on its own.
  const auditAction = ending
    ? `booking.update:free:${cancelReason}`
    : `booking.update:${status}`
  await writeAudit(c.env.DB, staff.sub, auditAction, 'bookings', id)

  // Freeing dates is the moment the waitlist matters: whoever was turned away
  // for exactly these dates should be called back. Surfaced with the response
  // so the UI can prompt without a second round trip.
  const waitlistMatches = ending
    ? await findWaitlistMatches(c.env.DB, unit.type, existing.date_from, existing.date_to, existing.unit_id)
    : []

  return c.json({
    ...serializeBooking(updated, canSeeMoney(staff.role)),
    waitlist_matches: waitlistMatches,
  })
})

/** PATCH /api/bookings/:id/payment — admin only. */
bookings.patch('/:id/payment', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const existing = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
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
      c.env.DB.prepare(`INSERT INTO payments (booking_id, amount, method, paid_at) VALUES (?, ?, ?, ${SQL_NOW})`).bind(
        id,
        paymentAmount,
        String(payment?.method ?? 'cash')
      )
    )
  } else if (prepaid !== existing.prepaid_amount) {
    // The admin corrected the figure outright rather than adding an instalment.
    // Book the difference so the ledger keeps matching `prepaid_amount` — the
    // delta may be negative, which is a refund or a correction.
    statements.push(
      c.env.DB.prepare(`INSERT INTO payments (booking_id, amount, method, paid_at) VALUES (?, ?, ?, ${SQL_NOW})`).bind(
        id,
        prepaid - existing.prepaid_amount,
        'adjustment'
      )
    )
  }

  await c.env.DB.batch(statements)

  const updated = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()

  await writeAudit(c.env.DB, staff.sub, 'booking.payment', 'bookings', id)
  return c.json(serializeBooking(updated!, true))
})

/**
 * Extra charges — damage, late checkout, minibar. Kept out of
 * `bookings.total_amount` so the room rate stays reportable on its own, and
 * added to the outstanding balance by `remainingOf`.
 */
type ChargeRow = {
  id: number
  booking_id: number
  reason: string
  amount: number
  created_at: string
  created_by_name: string | null
}

/** GET /api/bookings/:id/charges — admin only. */
bookings.get('/:id/charges', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const { results } = await c.env.DB.prepare(
    `SELECT ch.id, ch.booking_id, ch.reason, ch.amount, ch.created_at, su.name AS created_by_name
     FROM charges ch
     LEFT JOIN staff_users su ON su.id = ch.created_by
     WHERE ch.booking_id = ?
     ORDER BY ch.created_at DESC, ch.id DESC`
  )
    .bind(id)
    .all<ChargeRow>()

  return c.json(results)
})

/** POST /api/bookings/:id/charges — admin only. */
bookings.post('/:id/charges', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const booking = await c.env.DB.prepare('SELECT id FROM bookings WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()
  if (!booking) throw new HTTPException(404, { message: 'Booking not found' })

  const body = await readJson(c)
  const reason = String(body.reason ?? '').trim()
  const amount = Number(body.amount)

  if (!reason) throw new HTTPException(400, { message: 'Укажите причину начисления' })
  if (!Number.isFinite(amount) || amount === 0) {
    throw new HTTPException(400, { message: 'Сумма начисления должна быть ненулевым числом' })
  }

  const created = await c.env.DB.prepare(
    `INSERT INTO charges (booking_id, reason, amount, created_by, created_at)
     VALUES (?, ?, ?, ?, ${SQL_NOW}) RETURNING *`
  )
    .bind(id, reason, amount, staff.sub)
    .first<ChargeRow>()

  await writeAudit(c.env.DB, staff.sub, 'charge.create', 'charges', created?.id ?? null)
  return c.json({ ...created, created_by_name: staff.name }, 201)
})

/** DELETE /api/bookings/:bookingId/charges/:chargeId — admin only. */
bookings.delete('/:bookingId/charges/:chargeId', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const chargeId = Number(c.req.param('chargeId'))
  if (!Number.isInteger(chargeId)) throw new HTTPException(400, { message: 'Invalid charge id' })

  const removed = await c.env.DB.prepare('DELETE FROM charges WHERE id = ? RETURNING id')
    .bind(chargeId)
    .first<{ id: number }>()
  if (!removed) throw new HTTPException(404, { message: 'Charge not found' })

  await writeAudit(c.env.DB, staff.sub, 'charge.delete', 'charges', chargeId)
  return c.json({ deleted: true })
})

/** GET /api/bookings/:id/payments — admin only. */
bookings.get('/:id/payments', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const { results } = await c.env.DB.prepare(
    'SELECT id, booking_id, amount, method, paid_at, group_id FROM payments WHERE booking_id = ? ORDER BY paid_at DESC, id DESC'
  )
    .bind(id)
    .all()

  return c.json(results)
})

export default bookings