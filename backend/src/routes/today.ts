import { Hono } from 'hono'
import { canSeeMoney, placeholders, resolveTypeFilter } from '../lib/access'
import { chargesSumSql, remainingOf } from '../lib/money'
import { needsNotice } from '../lib/migration-notice'
import { SQL_TODAY } from '../lib/time'
import type { AppEnv, BookingStatus, UnitType } from '../types'

/**
 * GET /api/today — кто заезжает, кто выезжает, что снято с продажи.
 *
 * The most-asked question at any front desk, and until now the app answered it
 * with a **number**: the dashboard had a tile saying «Заезды сегодня 3» that
 * linked to the board, where the three had to be found by reading down a
 * column of fourteen rooms. The digest text had the names, but that is written
 * for a messenger blast and is not a working list.
 *
 * A departure is also the moment money changes hands, so the balance rides with
 * every row. That is the whole reason this is one screen and not two: the
 * person taking payment at 11am is the person handing keys over at 2pm.
 *
 * Everything is scoped by `allowedUnitTypes`, so a waiter opening it sees the
 * gazebo sittings starting today and an admin sees both.
 */
const today = new Hono<AppEnv>()

type Row = {
  id: number
  unit_id: number
  unit_name: string
  unit_type: UnitType
  guest_name: string
  guest_phone: string | null
  guest_citizenship: string | null
  arrived_on: string | null
  migration_notified_at: string | null
  date_from: string
  date_to: string
  status: BookingStatus
  verified_at: string | null
  total_amount: number
  prepaid_amount: number
  deposit_amount: number
  currency: string
  charges_total: number
  cleaning_pending: number
}

/** Whole nights between two dates, on UTC arithmetic. */
function nightsBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

today.get('/', async (c) => {
  const staff = c.get('staff')
  const types = resolveTypeFilter(staff.role, c.req.query('type'))
  const money = canSeeMoney(staff.role)

  const todayRow = await c.env.DB.prepare(`SELECT ${SQL_TODAY} AS d`).first<{ d: string }>()
  const day = todayRow?.d ?? new Date().toISOString().slice(0, 10)

  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.unit_id, u.name AS unit_name, u.type AS unit_type,
            b.guest_name, b.guest_phone, b.guest_citizenship,
            b.arrived_on, b.migration_notified_at,
            b.date_from, b.date_to, b.status, b.verified_at,
            b.total_amount, b.prepaid_amount, b.deposit_amount, b.currency,
            ${chargesSumSql('b')} AS charges_total,
            (SELECT COUNT(*) FROM cleaning_checklist cc
              WHERE cc.unit_id = u.id AND cc.is_done = 0) AS cleaning_pending
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
      WHERE b.status <> 'free'
        AND u.type IN (${placeholders(types.length)})
        AND (date(b.date_from) = date(?) OR date(b.date_to) = date(?))
      ORDER BY u.type, u.name`
  )
    .bind(...types, day, day)
    .all<Row>()

  const shape = (row: Row) => ({
    booking_id: row.id,
    unit_id: row.unit_id,
    unit_name: row.unit_name,
    unit_type: row.unit_type,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    date_from: row.date_from,
    date_to: row.date_to,
    nights: nightsBetween(row.date_from, row.date_to),
    status: row.status,
    verified_at: row.verified_at,
    /** The room is not ready. Said on the arrival, where it can still be fixed. */
    needs_cleaning: row.cleaning_pending > 0,
    cleaning_pending: row.cleaning_pending,
    /**
     * A foreign guest nobody has reported yet. Three calendar days from arrival
     * and a fine after that — and check-in is the one moment the passport is
     * physically on the desk, so it is the moment worth saying it.
     */
    migration_due: needsNotice(row, day),
    is_paid: remainingOf(row.total_amount, row.charges_total ?? 0, row.prepaid_amount) <= 0,
    ...(money
      ? {
          total_amount: row.total_amount,
          prepaid_amount: row.prepaid_amount,
          deposit_amount: row.deposit_amount,
          charges_amount: row.charges_total ?? 0,
          remaining_amount: remainingOf(row.total_amount, row.charges_total ?? 0, row.prepaid_amount),
          currency: row.currency,
        }
      : {}),
  })

  // A recreation sitting starts and ends the same day. It belongs in arrivals
  // and nowhere else: the waiter seats the party once, and listing it again
  // under departures would be asking them to do something twice.
  const arrivals = results.filter((row) => row.date_from.slice(0, 10) === day).map(shape)
  const departures = results
    .filter((row) => row.date_to.slice(0, 10) === day && row.date_from.slice(0, 10) !== day)
    .map(shape)

  const stayingRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM bookings b JOIN units u ON u.id = b.unit_id
      WHERE b.status <> 'free'
        AND u.type IN (${placeholders(types.length)})
        AND date(b.date_from) < date(?) AND date(b.date_to) > date(?)`
  )
    .bind(...types, day, day)
    .first<{ count: number }>()

  // Off sale today. It belongs here because this screen is read to answer «что
  // у нас сегодня», and a room under repair is part of that answer — the desk
  // should not have to discover it by trying to sell it.
  const { results: blocked } = await c.env.DB.prepare(
    `SELECT ub.id, ub.reason, ub.note, ub.date_to, u.name AS unit_name, u.type AS unit_type
       FROM unit_blocks ub JOIN units u ON u.id = ub.unit_id
      WHERE u.type IN (${placeholders(types.length)})
        AND date(ub.date_from) <= date(?) AND date(ub.date_to) > date(?)
      ORDER BY u.name`
  )
    .bind(...types, day, day)
    .all()

  return c.json({
    today: day,
    arrivals,
    departures,
    staying: stayingRow?.count ?? 0,
    blocked,
  })
})

export default today
