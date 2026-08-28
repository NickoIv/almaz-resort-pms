import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed, canSeeMoney } from '../lib/access'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { resetChecklist } from '../lib/cleaning'
import { writeAudit } from '../lib/audit'
import { chargesSumSql, remainingOf } from '../lib/money'
import { ADJUSTMENT_METHOD, assertPaymentMethod, resolveReceivedBy } from '../lib/payment'
import { cleanName, cleanOptional } from '../lib/text'
import { CANCEL_REASONS, isCancelReason, TRANSFER_REASON } from '../lib/cancellation'
import { assertNotBlocked } from '../lib/blocks'
import { assertNotUnderRenovation } from '../lib/renovation'
import { assertZoneExclusivity, banquetTotal } from '../lib/banquet'
import { carryOver, nightsBetween, prorate } from '../lib/transfer'
import { quoteStay } from '../lib/rates'
import { loadRates } from './rates'
import { findWaitlistMatches } from './waitlist'
import { addHours, almatyNow, almatyToday, SQL_NOW } from '../lib/time'
import type { AppEnv, BookingStatus, UnitType } from '../types'

type BookingRow = {
  id: number
  unit_id: number
  guest_name: string
  guest_phone: string | null
  guest_citizenship: string | null
  guest_document: string | null
  migration_notified_at: string | null
  migration_notified_by: number | null
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
  verified_at: string | null
  verified_by: number | null
  verified_by_name?: string | null
  moved_from_booking_id: number | null
  arrived_on: string | null
  moved_from_unit_name?: string | null
  deposit_returned: number | null
  deposit_returned_at: string | null
  deposit_returned_by: number | null
  /** Событие: сколько гостей и почём с человека. NULL у обычных броней. */
  guests_count: number | null
  price_per_person: number | null
  deposit_note: string | null
  deposit_returned_by_name?: string | null
}

const BOOKING_STATUSES: BookingStatus[] = ['free', 'booked', 'occupied']

/**
 * Always read bookings through this so the extra-charge total comes with them,
 * and so does the name of whoever checked the booking — an id would send the
 * reader to another screen to find out who that was.
 */
const BOOKING_SELECT = `SELECT b.*, ${chargesSumSql('b')} AS charges_total,
    ver.name AS verified_by_name,
    dep.name AS deposit_returned_by_name,
    src_unit.name AS moved_from_unit_name
  FROM bookings b
  LEFT JOIN staff_users ver ON ver.id = b.verified_by
  LEFT JOIN staff_users dep ON dep.id = b.deposit_returned_by
  LEFT JOIN bookings src ON src.id = b.moved_from_booking_id
  LEFT JOIN units src_unit ON src_unit.id = src.unit_id`

function serializeBooking(row: BookingRow, withMoney: boolean) {
  return {
    id: row.id,
    unit_id: row.unit_id,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    // Кто гость по паспорту. Empty means nobody said — deliberately not the
    // same as "citizen of Kazakhstan"; see lib/migration-notice.ts.
    guest_citizenship: row.guest_citizenship,
    guest_document: row.guest_document,
    migration_notified_at: row.migration_notified_at,
    date_from: row.date_from,
    date_to: row.date_to,
    status: row.status,
    created_at: row.created_at,
    group_id: row.group_id,
    cancel_reason: row.cancel_reason,
    cancel_note: row.cancel_note,
    cancelled_at: row.cancelled_at,
    // Shared with every role: a waiter reading a booking should be able to see
    // that nobody has checked it, which is the whole point of recording it.
    verified_at: row.verified_at,
    verified_by_name: row.verified_by_name ?? null,
    // Where this leg of a move came from. Shared with every role: a booking
    // that begins in the middle of a stay looks like a data error until the
    // screen says the guest was moved out of 101 this morning.
    moved_from_booking_id: row.moved_from_booking_id,
    moved_from_unit_name: row.moved_from_unit_name ?? null,
    /** The day the guest arrived, when this row is not where they started. */
    arrived_on: row.arrived_on,
    /**
     * Событие в костровой зоне. Число гостей видно всем — официант накрывает на
     * сорок человек и должен это знать; цена с человека едет только к тому, кто
     * вообще видит деньги.
     */
    guests_count: row.guests_count,
    is_paid: remainingOf(row.total_amount, row.charges_total ?? 0, row.prepaid_amount) <= 0,
    ...(withMoney
      ? {
          total_amount: row.total_amount,
          prepaid_amount: row.prepaid_amount,
          deposit_amount: row.deposit_amount,
          // A refundable hold has to be able to say it came back. NULL is
          // «ещё не вернули», which is not the same answer as 0 — that one
          // means the whole hold was kept.
          deposit_returned: row.deposit_returned,
          deposit_returned_at: row.deposit_returned_at,
          deposit_returned_by_name: row.deposit_returned_by_name ?? null,
          deposit_note: row.deposit_note,
          charges_amount: row.charges_total ?? 0,
          remaining_amount: remainingOf(row.total_amount, row.charges_total ?? 0, row.prepaid_amount),
          currency: row.currency,
          price_per_person: row.price_per_person,
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

/**
 * Are these nights actually sellable on this unit?
 *
 * Two ways they are not, and they are checked together on purpose: another
 * booking already holds them, or the object has been taken off sale for repair.
 * Five paths write a booking — create, quick seat, group, edit and переселение —
 * and a rule enforced by only some of them is a room that is out of order until
 * somebody uses the other button.
 */
async function assertSellable(
  db: D1Database,
  unitId: number,
  dateFrom: string,
  dateTo: string,
  ignoreBookingId: number | null,
  /** Тип нужен, чтобы отличить продажу зоны от продажи объекта внутри неё. */
  unitType?: string
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

  await assertNotBlocked(db, unitId, dateFrom, dateTo)
  // Реставрация не про даты: объекта нет вообще, поэтому проверяется без окна.
  await assertNotUnderRenovation(db, unitId)
  // Костровая зона продаётся целиком: занята зона — нельзя её беседку, занята
  // беседка — нельзя зону. Тип узнаём сами, если вызывающий его не передал:
  // забыть аргумент легче, чем заметить, что запрет перестал работать.
  const type =
    unitType ??
    (await db.prepare('SELECT type FROM units WHERE id = ?').bind(unitId).first<{ type: string }>())
      ?.type ??
    ''
  await assertZoneExclusivity(db, unitId, type, dateFrom, dateTo)
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
    // Every column qualified with `b.`: BOOKING_SELECT joins the bookings table
    // to itself to name the unit a move came out of, so a bare `date_from` is
    // ambiguous and the whole query 500s.
    `${BOOKING_SELECT}
     WHERE b.unit_id = ? AND date(b.date_to) >= date(?) AND date(b.date_from) <= date(?)
     ORDER BY b.date_from DESC`
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

  await assertSellable(c.env.DB, unitId, dateFrom, dateTo, null)

  // Waiters take bookings but do not set prices; admins may.
  const money = canSeeMoney(staff.role)
  // Событие считается от числа гостей: 40 человек по 17 000. Итог можно
  // поставить руками — администратор торгуется, — и тогда он побеждает, иначе
  // цифра, о которой договорились, тихо пересчиталась бы при сохранении.
  const guests = body.guests_count === undefined ? null : Number(body.guests_count)
  const perPerson = body.price_per_person === undefined ? null : Number(body.price_per_person)
  const total = money
    ? perPerson !== null || guests !== null
      ? banquetTotal(guests, perPerson, Number(body.total_amount ?? 0))
      : Number(body.total_amount ?? 0)
    : 0
  const prepaid = money ? Number(body.prepaid_amount ?? 0) : 0
  const deposit = money ? Number(body.deposit_amount ?? 0) : 0

  // Validated here, before the booking row exists, and not down beside the
  // INSERT that uses them. D1 runs these as separate statements, so a rejection
  // after the booking was written leaves the row behind holding the dates — the
  // admin corrects the payment method, tries again, and collides with their own
  // half-made booking.
  const prepaymentMethod = prepaid > 0 ? assertPaymentMethod(body.payment_method) : null
  const prepaymentReceivedBy =
    prepaid > 0 ? await resolveReceivedBy(c.env.DB, body.received_by, staff.sub) : null

  const created = await c.env.DB.prepare(
    `INSERT INTO bookings
       (unit_id, guest_name, guest_phone, guest_citizenship, guest_document,
        date_from, date_to, status,
        total_amount, prepaid_amount, deposit_amount, currency,
        guests_count, price_per_person, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})
     RETURNING *`
  )
    .bind(
      unitId,
      guestName,
      cleanOptional(body.guest_phone, 40),
      cleanOptional(body.guest_citizenship, 60),
      cleanOptional(body.guest_document, 60),
      dateFrom,
      dateTo,
      status,
      total,
      prepaid,
      deposit,
      String(body.currency ?? 'KZT'),
      guests,
      perPerson
    )
    .first<BookingRow>()

  if (!created) throw new HTTPException(500, { message: 'Failed to create booking' })

  // `payments` is the ledger analytics reads; an upfront prepayment has to land
  // there too, or the money is invisible to every revenue report.
  if (prepaid > 0) {
    await c.env.DB.prepare(
      `INSERT INTO payments (booking_id, amount, method, received_by, recorded_by, paid_at)
       VALUES (?, ?, ?, ?, ?, ${SQL_NOW})`
    )
      .bind(created.id, prepaid, prepaymentMethod, prepaymentReceivedBy, staff.sub)
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

  await assertSellable(c.env.DB, unitId, dateFrom, dateTo, null)

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
    await assertSellable(c.env.DB, unitId, dateFrom, dateTo, null)
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
  const method = assertPaymentMethod(body.method)
  const receivedBy = await resolveReceivedBy(c.env.DB, body.received_by, staff.sub)

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
        `INSERT INTO payments (booking_id, amount, method, group_id, received_by, recorded_by, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ${SQL_NOW})`
      ).bind(row.id, part, method, groupId, receivedBy, staff.sub)
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
  const guestCitizenship =
    body.guest_citizenship === undefined
      ? existing.guest_citizenship
      : cleanOptional(body.guest_citizenship, 60)
  const guestDocument =
    body.guest_document === undefined
      ? existing.guest_document
      : cleanOptional(body.guest_document, 60)
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
    await assertSellable(c.env.DB, existing.unit_id, dateFrom, dateTo, id)
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
     SET guest_name = ?, guest_phone = ?,
         guest_citizenship = ?, guest_document = ?,
         date_from = ?, date_to = ?, status = ?,
         cancel_reason = ?, cancel_note = ?,
         cancelled_at = CASE WHEN ? THEN ${SQL_NOW} ELSE cancelled_at END
     WHERE id = ?
     RETURNING *`
  )
    .bind(
      guestName,
      guestPhone,
      guestCitizenship,
      guestDocument,
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

  // Somebody having been in the unit is what queues it for cleaning — not the
  // booking merely ending.
  //
  // `status = 'free'` covers a checkout and a cancellation alike, and this used
  // to reset the checklist for both. So cancelling a booking as «Дубль брони»
  // or «Гость передумал» — a booking that had never been anything but
  // `booked`, on a room nobody had entered — created eight cleaning items, and
  // an hour later the SLA fired and pushed «Уборка просрочена» to the
  // housekeeper's phone about a room that was never used. The invented work
  // then had to be ticked off item by item to make it go away.
  //
  // Two ways in, and both are meant:
  //   - the guest was actually in there (`occupied`), whatever the reason for
  //     ending it — someone who leaves early still leaves a used room;
  //   - the reason given is «Обычный выезд», even from `booked`. Small hotels
  //     do check people out without ever having flipped the status to
  //     `occupied`, and taking the word of whoever wrote "the guest left" is
  //     the safe direction to be wrong in: an unnecessary clean costs a tick,
  //     a missed one costs the next guest.
  const wasUsed = existing.status === 'occupied' || cancelReason === 'checked_out'
  if (ending && wasUsed) {
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
  const payment = body.payment as
    | { amount?: unknown; method?: unknown; received_by?: unknown }
    | undefined
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
      c.env.DB.prepare(
        `INSERT INTO payments (booking_id, amount, method, received_by, recorded_by, paid_at)
         VALUES (?, ?, ?, ?, ?, ${SQL_NOW})`
      ).bind(
        id,
        paymentAmount,
        assertPaymentMethod(payment?.method),
        await resolveReceivedBy(c.env.DB, payment?.received_by, staff.sub),
        staff.sub
      )
    )
  } else if (prepaid !== existing.prepaid_amount) {
    // The admin corrected the figure outright rather than adding an instalment.
    // Book the difference so the ledger keeps matching `prepaid_amount` — the
    // delta may be negative, which is a refund or a correction.
    //
    // No method is asked for: nobody handed anything over, so it is booked as
    // an adjustment and attributed to whoever made the correction. Calling it
    // cash would put money in a till that never saw any.
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO payments (booking_id, amount, method, received_by, recorded_by, paid_at)
         VALUES (?, ?, ?, NULL, ?, ${SQL_NOW})`
      ).bind(id, prepaid - existing.prepaid_amount, ADJUSTMENT_METHOD, staff.sub)
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
 * POST /api/bookings/:id/verify — someone read the finished booking back and
 * says it matches what the guest asked for.
 *
 * Only the **first** check is kept. Pressing again on a booking that is already
 * verified changes nothing and returns the existing stamp: the fact worth
 * holding is that a booking was checked once and by whom, and letting a later
 * press overwrite it would quietly rename whoever actually did the checking.
 * A correction after that is an edit, and edits already have their own audit
 * trail.
 */
bookings.post('/:id/verify', canBook, async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const existing = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' })

  const unit = await loadUnit(c.env.DB, existing.unit_id)
  assertUnitTypeAllowed(staff.role, unit.type)

  const money = canSeeMoney(staff.role)
  if (existing.verified_at) return c.json(serializeBooking(existing, money))

  await c.env.DB.prepare(
    `UPDATE bookings SET verified_at = ${SQL_NOW}, verified_by = ? WHERE id = ?`
  )
    .bind(staff.sub, id)
    .run()

  // Re-read rather than RETURNING *: the charge total and the verifier's name
  // are joined on, and a bare row would report the balance as if there were no
  // extra charges.
  const updated = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()

  await writeAudit(c.env.DB, staff.sub, 'booking.verify', 'bookings', id)
  return c.json(serializeBooking(updated!, money))
})

/**
 * What a transfer of this booking would look like, before anyone commits to it.
 *
 * Shared by the GET below and the POST after it, so the dialog cannot offer a
 * move the endpoint would then refuse — the two used to be the classic place
 * for a rule to drift, since one is arithmetic on dates and the other is
 * arithmetic on dates.
 */
function planTransfer(booking: BookingRow, unitType: UnitType) {
  const today = almatyToday()
  const startsOn = booking.date_from.slice(0, 10)
  const endsOn = booking.date_to.slice(0, 10)
  // Rooms are the only thing that can be half-moved: a sitting at a gazebo has
  // no nights to divide, so it travels whole however far into it the party is.
  const splitDay = unitType === 'room' && startsOn < today ? today : null
  const nightsTotal = nightsBetween(startsOn, endsOn)
  const nightsBefore = splitDay ? nightsBetween(startsOn, splitDay) : 0
  return {
    today,
    startsOn,
    endsOn,
    splitDay,
    movedFrom: splitDay ?? booking.date_from,
    nightsBefore,
    nightsAfter: nightsTotal - nightsBefore,
    suggested: splitDay
      ? prorate(booking.total_amount, nightsBefore, nightsTotal)
      : { stay: 0, move: booking.total_amount },
  }
}

/**
 * Refuses a booking that cannot be moved at all.
 *
 * Called by the GET as well as the POST, on purpose: a dialog that listed rooms
 * and *then* refused would be teaching the desk not to trust the list.
 */
function assertTransferable(booking: BookingRow, plan: ReturnType<typeof planTransfer>): void {
  if (booking.status === 'free') {
    throw new HTTPException(400, { message: 'Бронь уже закрыта — переселять некого' })
  }
  // Nothing left to move: the stay is behind us, or its remaining nights are
  // none — the guest checks out this morning.
  if (plan.endsOn < plan.today || (plan.splitDay !== null && plan.endsOn === plan.today)) {
    throw new HTTPException(400, {
      message: 'Бронь уже заканчивается — переселять некуда',
    })
  }
}

type TransferTargetRow = {
  id: number
  name: string
  category: string | null
  capacity: number
  cleaning_pending: number
  taken_by: string | null
  blocked_reason: string | null
}

/**
 * GET /api/bookings/:id/transfer-targets — where this guest could go.
 *
 * Availability is answered here rather than by the caller filtering the board,
 * because "free" has to mean exactly what `assertSellable` means. A dialog that
 * worked it out from a timeline would offer a room the POST then refuses, and
 * the desk would learn to distrust the list.
 *
 * Occupied units are returned too, named by who is in them. A list that simply
 * omitted them answers "where can I put this guest" but not "why can't I put
 * them in 105", and the second question is the one that gets asked out loud.
 */
bookings.get('/:id/transfer-targets', canBook, async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const booking = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()
  if (!booking) throw new HTTPException(404, { message: 'Booking not found' })

  const from = await loadUnit(c.env.DB, booking.unit_id)
  assertUnitTypeAllowed(staff.role, from.type)

  const plan = planTransfer(booking, from.type)
  assertTransferable(booking, plan)
  const money = canSeeMoney(staff.role)

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.category, u.capacity,
            (SELECT COUNT(*) FROM cleaning_checklist cc
              WHERE cc.unit_id = u.id AND cc.is_done = 0) AS cleaning_pending,
            (SELECT b.guest_name FROM bookings b
              WHERE b.unit_id = u.id AND b.status <> 'free'
                AND datetime(b.date_from) < datetime(?) AND datetime(b.date_to) > datetime(?)
              ORDER BY b.date_from LIMIT 1) AS taken_by,
            -- Off sale counts as taken. A dialog that offered a room under
            -- repair would be offering one the POST refuses.
            (SELECT ub.reason FROM unit_blocks ub
              WHERE ub.unit_id = u.id
                AND datetime(ub.date_from) < datetime(?) AND datetime(ub.date_to) > datetime(?)
              ORDER BY ub.date_from LIMIT 1) AS blocked_reason
       FROM units u
      WHERE u.type = ? AND u.id <> ?
      ORDER BY u.name`
  )
    .bind(
      booking.date_to,
      plan.movedFrom,
      booking.date_to,
      plan.movedFrom,
      from.type,
      booking.unit_id
    )
    .all<TransferTargetRow>()

  // Priced per candidate, because the whole point of choosing a room is that
  // they are not all the same price. Withheld entirely when the list has
  // nothing to say about a unit — a partial quote undercharges silently.
  const rates = money ? await loadRates(c.env.DB) : []

  const units = results.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    capacity: row.capacity,
    free: row.taken_by === null && row.blocked_reason === null,
    taken_by: row.taken_by,
    blocked_reason: row.blocked_reason,
    needs_cleaning: row.cleaning_pending > 0,
    ...(money
      ? {
          quote: (() => {
            const quote = quoteStay(
              rates,
              { type: from.type, category: row.category },
              plan.movedFrom,
              booking.date_to
            )
            return quote.empty ? null : quote.total
          })(),
        }
      : {}),
  }))

  return c.json({
    mode: plan.splitDay ? ('split' as const) : ('whole' as const),
    split_on: plan.splitDay,
    moved_from: plan.movedFrom,
    date_to: booking.date_to,
    nights_before: plan.nightsBefore,
    nights_after: plan.nightsAfter,
    from_unit: { id: from.id, name: from.name, type: from.type },
    ...(money
      ? {
          currency: booking.currency,
          total_amount: booking.total_amount,
          prepaid_amount: booking.prepaid_amount,
          charges_amount: booking.charges_total ?? 0,
          deposit_amount: booking.deposit_amount,
          suggested_stay_amount: plan.suggested.stay,
          suggested_move_amount: plan.suggested.move,
        }
      : {}),
    units,
  })
})

/**
 * POST /api/bookings/:id/transfer — переселение: the guest changes unit and the
 * stay survives it.
 *
 * See lib/transfer.ts for why a stay under way is split and a stay that has not
 * started is simply moved, and for what happens to the money. This handler is
 * the plumbing; the reasoning is there.
 *
 * Body: `{ to_unit_id, stay_amount?, move_amount? }`. The two amounts are the
 * admin's re-quote of the legs — `stay_amount` for the nights already slept in
 * the old unit, `move_amount` for the continuation. Left out, the agreed price
 * divides pro rata by night and the guest's bill does not change.
 */
bookings.post('/:id/transfer', canBook, async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const existing = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' })

  const body = await readJson(c)
  const toUnitId = Number(body.to_unit_id)
  if (!Number.isInteger(toUnitId)) {
    throw new HTTPException(400, { message: 'Не выбран объект для переселения' })
  }
  if (toUnitId === existing.unit_id) {
    throw new HTTPException(400, { message: 'Гость уже живёт в этом объекте' })
  }

  const from = await loadUnit(c.env.DB, existing.unit_id)
  const to = await loadUnit(c.env.DB, toUnitId)
  assertUnitTypeAllowed(staff.role, from.type)
  assertUnitTypeAllowed(staff.role, to.type)

  // A room and a gazebo are not substitutes: one is sold by the night, the
  // other by the sitting, and every price, checklist and calendar rule below
  // follows from which of the two this is.
  if (from.type !== to.type) {
    throw new HTTPException(400, {
      message: `«${to.name}» — объект другого типа. Переселить можно только в такой же.`,
    })
  }
  const plan = planTransfer(existing, from.type)
  assertTransferable(existing, plan)
  const { splitDay } = plan

  const money = canSeeMoney(staff.role)

  await assertSellable(c.env.DB, toUnitId, plan.movedFrom, existing.date_to, splitDay ? null : id)

  // ── The whole booking moves: one row, one id, nothing else touched ────────
  if (!splitDay) {
    const newTotal =
      money && body.move_amount !== undefined ? Number(body.move_amount) : existing.total_amount
    if (!Number.isFinite(newTotal) || newTotal < 0) {
      throw new HTTPException(400, { message: 'Сумма должна быть неотрицательным числом' })
    }

    const moved = await c.env.DB.prepare(
      'UPDATE bookings SET unit_id = ?, total_amount = ? WHERE id = ? RETURNING id'
    )
      .bind(toUnitId, newTotal, id)
      .first<{ id: number }>()
    if (!moved) throw new HTTPException(500, { message: 'Не удалось переселить бронь' })

    // Somebody having been in the unit is what queues it for cleaning — the
    // same rule as a checkout. A reservation that has not started yet leaves
    // nothing behind, and inventing a checklist for it would put a clean room
    // in the housekeeper's queue and fire the SLA an hour later.
    if (existing.status === 'occupied') {
      await resetChecklist(c.env.DB, existing.unit_id, from.type, id)
    }

    await writeAudit(
      c.env.DB,
      staff.sub,
      `booking.transfer:${from.name}→${to.name}`,
      'bookings',
      id
    )

    const updated = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
      .bind(id)
      .first<BookingRow>()

    return c.json({
      mode: 'whole' as const,
      from_unit: { id: from.id, name: from.name },
      to_unit: { id: to.id, name: to.name },
      booking: serializeBooking(updated!, money),
      previous: null,
    })
  }

  // ── The stay is under way: close this leg today, continue in the new unit ──
  const stayTotal =
    money && body.stay_amount !== undefined ? Number(body.stay_amount) : plan.suggested.stay
  const moveTotal =
    money && body.move_amount !== undefined ? Number(body.move_amount) : plan.suggested.move
  if ([stayTotal, moveTotal].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new HTTPException(400, { message: 'Суммы должны быть неотрицательными числами' })
  }

  const carried = carryOver(existing.prepaid_amount, stayTotal, existing.charges_total ?? 0)

  // The continuation is written first and paid for second: a batch that fails
  // half way then leaves the guest visible in two rooms, which the desk can see
  // and undo, rather than money counted twice, which it cannot.
  const created = await c.env.DB.prepare(
    `INSERT INTO bookings
       (unit_id, guest_name, guest_phone, guest_citizenship, guest_document,
        migration_notified_at, migration_notified_by,
        date_from, date_to, status,
        total_amount, prepaid_amount, deposit_amount, currency, group_id,
        moved_from_booking_id, arrived_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ${SQL_NOW})
     RETURNING *`
  )
    .bind(
      toUnitId,
      existing.guest_name,
      existing.guest_phone,
      existing.guest_citizenship,
      existing.guest_document,
      // The notice has been filed for this arrival or it has not; moving rooms
      // does not un-file it, and re-asking would send the hotel to eQonaq twice.
      existing.migration_notified_at,
      existing.migration_notified_by,
      splitDay,
      existing.date_to,
      existing.status,
      moveTotal,
      existing.deposit_amount,
      existing.currency,
      existing.group_id,
      id,
      // The three-day migration clock runs from the arrival, not from this row.
      existing.arrived_on ?? existing.date_from.slice(0, 10)
    )
    .first<BookingRow>()

  if (!created) throw new HTTPException(500, { message: 'Не удалось создать бронь в новом объекте' })

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE bookings
          SET date_to = ?, total_amount = ?, prepaid_amount = ?, deposit_amount = 0,
              status = 'free', cancel_reason = ?, cancel_note = ?, cancelled_at = ${SQL_NOW}
        WHERE id = ?`
    ).bind(
      splitDay,
      stayTotal,
      Number((existing.prepaid_amount - carried).toFixed(2)),
      TRANSFER_REASON,
      `Переселение в «${to.name}»`,
      id
    ),
  ]

  // Both halves of the carry, or neither: the pair sums to zero, so a report
  // that saw only one of them would be short exactly the amount that moved.
  if (carried > 0) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO payments (booking_id, amount, method, received_by, recorded_by, paid_at)
         VALUES (?, ?, ?, NULL, ?, ${SQL_NOW})`
      ).bind(id, -carried, ADJUSTMENT_METHOD, staff.sub),
      c.env.DB.prepare('UPDATE bookings SET prepaid_amount = ? WHERE id = ?').bind(
        carried,
        created.id
      ),
      c.env.DB.prepare(
        `INSERT INTO payments (booking_id, amount, method, received_by, recorded_by, paid_at)
         VALUES (?, ?, ?, NULL, ?, ${SQL_NOW})`
      ).bind(created.id, carried, ADJUSTMENT_METHOD, staff.sub)
    )
  }

  await c.env.DB.batch(statements)

  // The guest slept in the old unit — those nights are the whole reason this is
  // a split — so it needs cleaning whatever the status column happened to say.
  await resetChecklist(c.env.DB, existing.unit_id, from.type, id)

  await writeAudit(
    c.env.DB,
    staff.sub,
    `booking.transfer:${from.name}→${to.name}`,
    'bookings',
    created.id
  )

  const [continuation, closed] = await Promise.all([
    c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).bind(created.id).first<BookingRow>(),
    c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<BookingRow>(),
  ])

  return c.json({
    mode: 'split' as const,
    from_unit: { id: from.id, name: from.name },
    to_unit: { id: to.id, name: to.name },
    split_on: splitDay,
    nights_before: plan.nightsBefore,
    nights_after: plan.nightsAfter,
    carried_amount: money ? carried : undefined,
    booking: serializeBooking(continuation!, money),
    previous: serializeBooking(closed!, money),
  })
})

/**
 * POST /api/bookings/:id/deposit-return — залог отдан гостю.
 *
 * The deposit has been stored and displayed as «возвратный, не входит в
 * остаток» since the beginning, and nothing recorded that it went back. So the
 * question «вернули ли 5 000?» had no answer anywhere, and the figure sat on
 * the booking for ever — the one thing a refundable hold must never do.
 *
 * **A withheld part is booked, not merely mentioned.** Money the hotel keeps
 * for damage is money the hotel earned, and leaving it as a smaller number in a
 * text field would make it invisible in every revenue report — the same class
 * of hole as writing a repair as a fake booking. It becomes a `charge` for the
 * stated reason plus a matching `adjustment` payment that settles it, because
 * the guest handed the money over at check-in and it is now being kept: nothing
 * is owed afterwards, and both facts are in the ledger.
 *
 * Only the first return is kept, like the verification stamp. A second press
 * must not rewrite who handed the money back.
 */
bookings.post('/:id/deposit-return', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid booking id' })

  const existing = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()
  if (!existing) throw new HTTPException(404, { message: 'Booking not found' })

  if (existing.deposit_returned_at) {
    return c.json(serializeBooking(existing, true))
  }
  if (!(existing.deposit_amount > 0)) {
    throw new HTTPException(400, { message: 'По этой броне залог не брали' })
  }

  const body = await readJson(c)
  const amount = body.amount === undefined ? existing.deposit_amount : Number(body.amount)
  const note = cleanOptional(body.note, 300)

  if (!Number.isFinite(amount) || amount < 0 || amount > existing.deposit_amount) {
    throw new HTTPException(400, {
      message: `Вернуть можно от 0 до ${existing.deposit_amount}`,
    })
  }

  const withheld = Number((existing.deposit_amount - amount).toFixed(2))
  if (withheld > 0 && !note) {
    // «Удержано 5 000» with no reason is the start of an argument nobody can
    // settle a week later.
    throw new HTTPException(400, { message: 'Если удерживаете часть залога — напишите, за что' })
  }

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE bookings
          SET deposit_returned = ?, deposit_returned_at = ${SQL_NOW},
              deposit_returned_by = ?, deposit_note = ?
        WHERE id = ?`
    ).bind(amount, staff.sub, note, id),
  ]

  if (withheld > 0) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO charges (booking_id, reason, amount, created_by, created_at)
         VALUES (?, ?, ?, ?, ${SQL_NOW})`
      ).bind(id, `Удержано из залога: ${note}`, withheld, staff.sub),
      // The guest is not asked for this again — they left it at check-in. The
      // charge and this entry cancel out, so the balance stays where it was.
      c.env.DB.prepare(
        `INSERT INTO payments (booking_id, amount, method, received_by, recorded_by, paid_at)
         VALUES (?, ?, ?, NULL, ?, ${SQL_NOW})`
      ).bind(id, withheld, ADJUSTMENT_METHOD, staff.sub),
      c.env.DB.prepare(
        'UPDATE bookings SET prepaid_amount = prepaid_amount + ? WHERE id = ?'
      ).bind(withheld, id)
    )
  }

  await c.env.DB.batch(statements)

  await writeAudit(
    c.env.DB,
    staff.sub,
    withheld > 0 ? 'booking.deposit:withheld' : 'booking.deposit:returned',
    'bookings',
    id
  )

  const updated = await c.env.DB.prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<BookingRow>()

  return c.json({ ...serializeBooking(updated!, true), withheld })
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

  // The names, not the ids: this list is read to answer "who has this money",
  // and an id sends the reader to another screen to find out.
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.booking_id, p.amount, p.method, p.paid_at, p.group_id,
            p.received_by, rec.name AS received_by_name,
            p.recorded_by, ent.name AS recorded_by_name
       FROM payments p
       LEFT JOIN staff_users rec ON rec.id = p.received_by
       LEFT JOIN staff_users ent ON ent.id = p.recorded_by
      WHERE p.booking_id = ?
      ORDER BY p.paid_at DESC, p.id DESC`
  )
    .bind(id)
    .all()

  return c.json(results)
})

export default bookings