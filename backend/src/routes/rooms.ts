import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { SQL_TODAY } from '../lib/time'
import type { AppEnv, BookingStatus } from '../types'

const rooms = new Hono<AppEnv>()

/** Rooms are the admin's concern; housekeepers work from the cleaning list. */
rooms.use('*', requireRole('admin'))

const DEFAULT_DAYS = 7
const MAX_DAYS = 30

type TimelineRow = {
  unit_id: number
  unit_name: string
  category: string | null
  capacity: number
  booking_id: number | null
  guest_name: string | null
  status: BookingStatus | null
  date_from: string | null
  date_to: string | null
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
            b.id AS booking_id, b.guest_name, b.status, b.date_from, b.date_to
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

  const startRow = await c.env.DB.prepare(`SELECT ${startExpr} AS d`)
    .bind(...startBind)
    .first<{ d: string }>()
  const start = startRow?.d ?? new Date().toISOString().slice(0, 10)

  // One entry per room, in the order the query returned them.
  const byRoom = new Map<number, {
    unit_id: number
    unit_name: string
    category: string | null
    capacity: number
    bookings: {
      id: number
      guest_name: string | null
      status: BookingStatus
      date_from: string
      date_to: string
    }[]
  }>()

  for (const row of results) {
    if (!byRoom.has(row.unit_id)) {
      byRoom.set(row.unit_id, {
        unit_id: row.unit_id,
        unit_name: row.unit_name,
        category: row.category,
        capacity: row.capacity,
        bookings: [],
      })
    }
    // A LEFT JOIN miss is a room with nothing booked, not a booking to add.
    if (row.booking_id !== null && row.date_from && row.date_to && row.status) {
      byRoom.get(row.unit_id)!.bookings.push({
        id: row.booking_id,
        guest_name: row.guest_name,
        status: row.status,
        date_from: row.date_from,
        date_to: row.date_to,
      })
    }
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

export default rooms
