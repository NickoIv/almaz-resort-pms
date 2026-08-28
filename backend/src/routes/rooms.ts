import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { chargesSumSql } from '../lib/money'
import { SQL_TODAY } from '../lib/time'
import type { AppEnv, BookingStatus } from '../types'

const rooms = new Hono<AppEnv>()

/** Rooms are the admin's concern; housekeepers work from the cleaning list. */
rooms.use('*', requireRole('admin'))

const DEFAULT_DAYS = 7

/**
 * 31, so a calendar month always fits.
 *
 * It was 30, which made «Месяц» a rolling thirty days that came up one short in
 * every 31-day month — the board could not show the whole of August at all.
 */
const MAX_DAYS = 31

type TimelineRow = {
  unit_id: number
  unit_name: string
  category: string | null
  capacity: number
  renovation_since: string | null
  renovation_note: string | null
  booking_id: number | null
  guest_name: string | null
  guest_phone: string | null
  status: BookingStatus | null
  date_from: string | null
  date_to: string | null
  total_amount: number | null
  prepaid_amount: number | null
  deposit_amount: number | null
  charges_total: number | null
  currency: string | null
}

/** `2026-08-09`, and nothing else. */
function parseFrom(raw: string | undefined): string | null {
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // Rejects the likes of 2026-02-31, which Date rolls forward rather than
  // refusing — the round-trip catches it.
  return parsed.toISOString().slice(0, 10) === raw ? raw : null
}

/**
 * GET /api/rooms/timeline?from=YYYY-MM-DD&days=N
 *
 * Every room, with the bookings overlapping the window — the shape a Gantt
 * chart needs: one row per room, and each booking carrying its true start and
 * end rather than a per-day flag, so a five-night stay draws as one bar
 * instead of five cells the client has to stitch back together.
 *
 * Rooms with no bookings in the window come back too, with an empty list. An
 * availability view whose empty rows vanished would be showing the opposite of
 * what it is for.
 *
 * `from` defaults to today in Almaty, so an omitted parameter cannot land the
 * caller on the wrong day west or east of the hotel.
 */
rooms.get('/timeline', async (c) => {
  const rawFrom = c.req.query('from')
  if (rawFrom !== undefined && parseFrom(rawFrom) === null) {
    throw new HTTPException(400, { message: 'from: ожидается дата в формате YYYY-MM-DD' })
  }
  const from = parseFrom(rawFrom)

  const requested = Number(c.req.query('days') ?? DEFAULT_DAYS)
  const days = Math.min(
    Math.max(Number.isFinite(requested) ? Math.trunc(requested) : DEFAULT_DAYS, 1),
    MAX_DAYS
  )

  // Bound as a parameter when supplied, otherwise Almaty's today.
  const startExpr = from === null ? SQL_TODAY : 'date(?)'
  const startBind = from === null ? [] : [from]

  const { results } = await c.env.DB.prepare(
    `WITH win(start, end) AS (
       SELECT ${startExpr}, date(${startExpr}, '+' || ? || ' days')
     )
     SELECT u.id AS unit_id, u.name AS unit_name, u.category, u.capacity,
            u.renovation_since, u.renovation_note,
            b.id AS booking_id, b.guest_name, b.guest_phone, b.status,
            b.date_from, b.date_to,
            b.total_amount, b.prepaid_amount, b.deposit_amount, b.currency,
            ${chargesSumSql('b')} AS charges_total
     FROM units u
     LEFT JOIN bookings b
       ON b.unit_id = u.id
      AND b.status <> 'free'
      -- Half-open overlap: a stay ending on the window's first day has already
      -- checked out that morning and does not belong on the chart.
      AND date(b.date_from) < (SELECT end FROM win)
      AND date(b.date_to)   > (SELECT start FROM win)
     WHERE u.type = 'room'
     ORDER BY u.name, b.date_from`
  )
    .bind(...startBind, ...startBind, days)
    .all<TimelineRow>()

  // Blocks ride with the bars. The board already derives the free-per-night
  // header, the drag-collision check and the cell shading from one list per
  // room, so folding blocks into that list is the only way all three agree —
  // and a night that cannot be sold has to look unsellable in the header too.
  const { results: blockRows } = await c.env.DB.prepare(
    `WITH win(start, end) AS (
       SELECT ${startExpr}, date(${startExpr}, '+' || ? || ' days')
     )
     SELECT ub.id, ub.unit_id, ub.date_from, ub.date_to, ub.reason, ub.note
       FROM unit_blocks ub
       JOIN units u ON u.id = ub.unit_id
      WHERE u.type = 'room'
        AND date(ub.date_from) < (SELECT end FROM win)
        AND date(ub.date_to)   > (SELECT start FROM win)
      ORDER BY ub.date_from`
  )
    .bind(...startBind, ...startBind, days)
    .all<{ id: number; unit_id: number; date_from: string; date_to: string; reason: string; note: string | null }>()

  const startRow = await c.env.DB.prepare(`SELECT ${startExpr} AS d`)
    .bind(...startBind)
    .first<{ d: string }>()
  const start = startRow?.d ?? new Date().toISOString().slice(0, 10)

  // One entry per room, in the order the query returned them.
  // The whole booking, not just its dates: this endpoint is admin-only, and
  // carrying the money here means the board can open the edit form without a
  // second round trip for something it already knows.
  const byRoom = new Map<number, {
    unit_id: number
    unit_name: string
    category: string | null
    capacity: number
    renovation: { since: string; note: string | null } | null
    blocks: {
      id: number
      date_from: string
      date_to: string
      reason: string
      note: string | null
    }[]
    bookings: {
      id: number
      guest_name: string | null
      guest_phone: string | null
      status: BookingStatus
      date_from: string
      date_to: string
      total_amount: number
      prepaid_amount: number
      deposit_amount: number
      charges_amount: number
      remaining_amount: number
      currency: string
    }[]
  }>()

  for (const row of results) {
    if (!byRoom.has(row.unit_id)) {
      byRoom.set(row.unit_id, {
        unit_id: row.unit_id,
        unit_name: row.unit_name,
        category: row.category,
        capacity: row.capacity,
        // Строка остаётся на доске, но помеченной. Спрятать объект на
        // реставрации было бы удобнее глазу и хуже по делу: инвентарь, тихо
        // исчезнувший с главного экрана, — это инвентарь, про который забыли.
        renovation: row.renovation_since
          ? { since: row.renovation_since, note: row.renovation_note }
          : null,
        blocks: [],
        bookings: [],
      })
    }
    // A LEFT JOIN miss is a room with nothing booked, not a booking to add.
    if (row.booking_id !== null && row.date_from && row.date_to && row.status) {
      const total = row.total_amount ?? 0
      const charges = row.charges_total ?? 0
      const prepaid = row.prepaid_amount ?? 0
      byRoom.get(row.unit_id)!.bookings.push({
        id: row.booking_id,
        guest_name: row.guest_name,
        guest_phone: row.guest_phone,
        status: row.status,
        date_from: row.date_from,
        date_to: row.date_to,
        total_amount: total,
        prepaid_amount: prepaid,
        deposit_amount: row.deposit_amount ?? 0,
        charges_amount: charges,
        // Same formula as everywhere else: rate + charges − paid, deposit apart.
        remaining_amount: Number((total + charges - prepaid).toFixed(2)),
        currency: row.currency ?? 'KZT',
      })
    }
  }

  for (const block of blockRows) {
    byRoom.get(block.unit_id)?.blocks.push({
      id: block.id,
      date_from: block.date_from,
      date_to: block.date_to,
      reason: block.reason,
      note: block.note,
    })
  }

  const dates = Array.from({ length: days }, (_, index) => {
    const day = new Date(`${start}T00:00:00Z`)
    day.setUTCDate(day.getUTCDate() + index)
    return day.toISOString().slice(0, 10)
  })

  return c.json({
    from: start,
    days,
    max_days: MAX_DAYS,
    dates,
    rooms: [...byRoom.values()],
  })
})

/** Days in a 1-based month, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Whole days between two YYYY-MM-DD strings. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  )
}

/**
 * How many nights of `[from, to)` fall inside `[monthStart, monthEnd)`.
 *
 * Half-open at both ends, the same rule as everywhere else: a stay ending on the
 * 1st of a month contributes nothing to that month, because the guest left that
 * morning. Clipping rather than counting whole stays is what makes a booking
 * that straddles new year land partly in December and partly in January instead
 * of being counted twice or dropped.
 */
function nightsInMonth(from: string, to: string, monthStart: string, monthEnd: string): number {
  const start = from > monthStart ? from : monthStart
  const end = to < monthEnd ? to : monthEnd
  return Math.max(0, daysBetween(start, end))
}

/**
 * GET /api/rooms/year?year=YYYY — the whole year at month granularity.
 *
 * A year cannot be drawn in day columns. Thirty days already overflow a phone
 * six times over, so 365 would be a chart nobody can see: the useful question at
 * this range is not "which night" but "which months are filling up", and that
 * answer fits on one screen in twelve columns.
 *
 * Nights sold, not bookings counted — two one-night stays and one two-night
 * stay fill a room equally, and it is the filling that is being asked about.
 */
rooms.get('/year', async (c) => {
  const raw = c.req.query('year')
  const year = raw === undefined ? new Date().getUTCFullYear() : Number(raw)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HTTPException(400, { message: 'year: ожидается год между 2000 и 2100' })
  }

  const yearStart = `${year}-01-01`
  const yearEnd = `${year + 1}-01-01`

  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS unit_id, u.name AS unit_name, u.category, u.capacity,
            b.id AS booking_id, b.date_from, b.date_to
     FROM units u
     LEFT JOIN bookings b
       ON b.unit_id = u.id
      AND b.status <> 'free'
      AND date(b.date_from) < date(?)
      AND date(b.date_to)   > date(?)
     WHERE u.type = 'room' AND u.renovation_since IS NULL
     ORDER BY u.name, b.date_from`
  )
    .bind(yearEnd, yearStart)
    .all<{
      unit_id: number
      unit_name: string
      category: string | null
      capacity: number
      booking_id: number | null
      date_from: string | null
      date_to: string | null
    }>()

  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      start: `${year}-${String(month).padStart(2, '0')}-01`,
      end:
        month === 12
          ? `${year + 1}-01-01`
          : `${year}-${String(month + 1).padStart(2, '0')}-01`,
      nights_total: daysInMonth(year, month),
    }
  })

  const byRoom = new Map<
    number,
    { unit_id: number; unit_name: string; category: string | null; capacity: number; sold: number[] }
  >()

  for (const row of results) {
    if (!byRoom.has(row.unit_id)) {
      byRoom.set(row.unit_id, {
        unit_id: row.unit_id,
        unit_name: row.unit_name,
        category: row.category,
        capacity: row.capacity,
        sold: new Array(12).fill(0),
      })
    }
    // A LEFT JOIN miss is a room with nothing booked all year, which still has
    // to appear — an availability view that hides its empty rooms is showing
    // the opposite of what it is for.
    if (row.booking_id === null || !row.date_from || !row.date_to) continue

    const entry = byRoom.get(row.unit_id)!
    const from = row.date_from.slice(0, 10)
    const to = row.date_to.slice(0, 10)
    months.forEach((month, index) => {
      entry.sold[index] += nightsInMonth(from, to, month.start, month.end)
    })
  }

  const roomsOut = [...byRoom.values()]

  return c.json({
    year,
    rooms_total: roomsOut.length,
    months: months.map((month, index) => {
      const sold = roomsOut.reduce((sum, room) => sum + room.sold[index], 0)
      const available = month.nights_total * roomsOut.length
      return {
        month: month.key,
        nights_total: month.nights_total,
        nights_sold: sold,
        nights_available: available,
        occupancy_rate: available > 0 ? sold / available : 0,
        // How many rooms have nothing at all booked that month — the number a
        // person actually reads off an availability chart.
        rooms_free: roomsOut.filter((room) => room.sold[index] === 0).length,
      }
    }),
    rooms: roomsOut.map((room) => ({
      unit_id: room.unit_id,
      unit_name: room.unit_name,
      category: room.category,
      capacity: room.capacity,
      months: months.map((month, index) => ({
        month: month.key,
        nights_sold: room.sold[index],
        nights_total: month.nights_total,
      })),
    })),
  })
})

export default rooms
