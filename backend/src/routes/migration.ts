import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { writeAudit } from '../lib/audit'
import { loadTextSettings } from '../lib/notifications'
import { SQL_NOW, SQL_TODAY } from '../lib/time'
import {
  arrivalOf,
  daysLeft,
  noticeDue,
  noticeState,
  NOTICE_DAYS,
  type MigrationRow,
} from '../lib/migration-notice'
import type { AppEnv } from '../types'

const migration = new Hono<AppEnv>()

// The register carries guests' passport numbers, so it is admin-only like the
// rest of what identifies a person.
migration.use('*', requireRole('admin'))

const SELECT = `
  SELECT b.id AS booking_id, b.guest_name, b.guest_phone,
         b.guest_citizenship, b.guest_document,
         b.date_from, b.date_to, b.arrived_on,
         b.migration_notified_at,
         u.id AS unit_id, u.name AS unit_name,
         su.name AS migration_notified_by_name
    FROM bookings b
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN staff_users su ON su.id = b.migration_notified_by
   WHERE u.type = 'room'
     AND b.status <> 'free'
`

/**
 * GET /api/migration — the register, in the three states it has.
 *
 * `due` is what the hotel is on the hook for, soonest deadline first. `unknown`
 * is arrivals whose citizenship nobody recorded — not treated as foreign, but
 * shown, because a foreign guest missed through silence is the failure mode
 * this whole screen exists to prevent. `filed` is the recent history, so a
 * question about a past guest has an answer.
 */
migration.get('/', async (c) => {
  const todayRow = await c.env.DB.prepare(`SELECT ${SQL_TODAY} AS today`).first<{ today: string }>()
  const today = todayRow?.today ?? new Date().toISOString().slice(0, 10)

  const { results } = await c.env.DB.prepare(
    `${SELECT} AND date(b.date_from) >= date(?, '-60 days') ORDER BY b.date_from DESC`
  )
    .bind(today)
    .all<MigrationRow>()

  // The arrival, not this row's start: a guest переселён on the second night
  // keeps the deadline the hotel already had. Only the live leg of a move is
  // here at all — the one it continues is `free` and filtered out above — so
  // each arrival still appears exactly once.
  const arrived = (row: MigrationRow) => arrivalOf(row) <= today

  const due = results
    .filter((row) => noticeState(row.guest_citizenship) === 'foreign')
    .filter((row) => !row.migration_notified_at && arrived(row))
    .map((row) => ({
      ...row,
      due_on: noticeDue(arrivalOf(row)),
      days_left: daysLeft(arrivalOf(row), today),
    }))
    .sort((a, b) => a.days_left - b.days_left)

  const unknown = results.filter(
    (row) => noticeState(row.guest_citizenship) === 'unknown' && arrived(row)
  )

  const filed = results
    .filter((row) => row.migration_notified_at)
    .slice(0, 50)
    .map((row) => ({ ...row, due_on: noticeDue(arrivalOf(row)), days_left: 0 }))

  // The notice needs the address of stay, and that is the hotel's own — it
  // lives in settings, so the screen can offer it for copying rather than
  // making someone remember it.
  const text = await loadTextSettings(c.env.DB)

  return c.json({
    today,
    notice_days: NOTICE_DAYS,
    hotel_name: text.hotel_name,
    hotel_address: text.invoice_legal_address || text.hotel_details,
    due,
    unknown,
    filed,
  })
})

/**
 * POST /api/migration/:bookingId/filed — record that the notice was submitted.
 *
 * The app does not file anything: eQonaq wants the receiving party's ЭЦП, which
 * belongs to the hotel and not to a web app. This marks the human act, so the
 * deadline stops counting and the register can answer "was it sent?" later.
 */
migration.post('/:bookingId/filed', async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('bookingId'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Некорректная бронь' })

  const booking = await c.env.DB.prepare(
    'SELECT id, guest_citizenship, migration_notified_at FROM bookings WHERE id = ?'
  )
    .bind(id)
    .first<{ id: number; guest_citizenship: string | null; migration_notified_at: string | null }>()
  if (!booking) throw new HTTPException(404, { message: 'Бронь не найдена' })

  if (noticeState(booking.guest_citizenship) !== 'foreign') {
    throw new HTTPException(400, {
      message: 'Уведомление нужно только для гостя с иностранным гражданством',
    })
  }

  // Only the first mark is kept, like the booking check: a later press must not
  // rewrite who filed it or when.
  if (!booking.migration_notified_at) {
    await c.env.DB.prepare(
      `UPDATE bookings
          SET migration_notified_at = ${SQL_NOW}, migration_notified_by = ?
        WHERE id = ?`
    )
      .bind(staff.sub, id)
      .run()
    await writeAudit(c.env.DB, staff.sub, 'migration.filed', 'bookings', id)
  }

  const updated = await c.env.DB.prepare(
    `SELECT migration_notified_at FROM bookings WHERE id = ?`
  )
    .bind(id)
    .first<{ migration_notified_at: string | null }>()

  return c.json({ booking_id: id, migration_notified_at: updated?.migration_notified_at ?? null })
})

export default migration
