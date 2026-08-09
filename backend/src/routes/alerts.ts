import { Hono } from 'hono'
import { allowedUnitTypes, placeholders } from '../lib/access'
import { requireRole } from '../lib/auth'
import { CLEANING_SLA_MINUTES } from '../lib/cleaning'
import { SQL_NOW, SQL_TODAY } from '../lib/time'
import type { AppEnv, UnitType } from '../types'

const alerts = new Hono<AppEnv>()

/**
 * Things a member of staff should be told about without going looking.
 *
 * One endpoint rather than three polls: the client asks every 45 seconds, and
 * splitting that across three requests would triple the traffic to answer one
 * question. Role scoping stays on the server, like everywhere else — a
 * housekeeper's poll must not carry a booking they are not allowed to see, not
 * even for the client to filter out.
 *
 * Every alert carries a **stable id**. The client remembers which ids it has
 * already announced and which the user has dismissed, so an alert sounds once
 * when it appears and then stays quiet while it remains outstanding. The ids
 * encode what makes an event new:
 *
 *   sla:<unit>:<since>   — a unit dirtied again is a different wait, so the
 *                          timestamp is part of the id
 *   waitlist:<entry>     — one guest waiting, however often a unit frees and
 *                          fills again while they wait
 *   booking:<audit row>  — audit rows are append-only, so the id is unique
 *                          per booking actually created
 */

/** How far back a colleague's booking is still worth announcing. */
const BOOKING_WINDOW_HOURS = 8

/** Cap per category, so a quiet client cannot be handed a thousand alerts. */
const MAX_PER_KIND = 25

// Waiters are deliberately not included: the recreation area has no event in
// this set they can act on, and the waitlist page they would be sent to is
// admin-only. Adding them means giving them a scoped waitlist view first.
const canSeeAlerts = requireRole('admin', 'housekeeper')

type Alert = {
  id: string
  kind: 'sla' | 'waitlist' | 'booking'
  title: string
  detail: string
  /** Where to go to act on it. */
  href: string
  /** Almaty wall-clock, for ordering and for showing how long it has waited. */
  at: string
}

type SlaRow = {
  unit_id: number
  unit_name: string
  unit_type: UnitType
  pending: number
  waiting_since: string
  waiting_minutes: number
}

type WaitlistRow = {
  id: number
  guest_name: string
  guest_phone: string | null
  unit_type: UnitType
  unit_name: string | null
  date_from: string
  date_to: string
  created_at: string
  free_units: number
}

type BookingRow = {
  audit_id: number
  created_at: string
  staff_name: string | null
  booking_id: number
  guest_name: string | null
  unit_id: number | null
  unit_name: string | null
  unit_type: UnitType | null
}

const UNIT_WORDS: Record<UnitType, string> = {
  room: 'Номер',
  sunbed: 'Топчан',
  gazebo: 'Беседка',
  vip_gazebo: 'VIP-беседка',
}

/** Rooms open at /rooms/:id; everything else at /units/:id. */
function unitHref(id: number, type: UnitType | null): string {
  return type === 'room' ? `/rooms/${id}` : `/units/${id}`
}

function elapsed(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  if (safe < 60) return `${safe} мин`
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`
}

alerts.get('/', canSeeAlerts, async (c) => {
  const staff = c.get('staff')
  const types = allowedUnitTypes(staff.role)
  const isAdmin = staff.role === 'admin'
  const out: Alert[] = []

  // ── 1. Cleaning past the SLA ────────────────────────────────────────────
  // Same shape the cleaning page computes, filtered to the breaches only.
  const { results: overdue } = await c.env.DB.prepare(
    `SELECT u.id AS unit_id, u.name AS unit_name, u.type AS unit_type,
            COUNT(*) AS pending,
            MIN(cc.created_at) AS waiting_since,
            (julianday(${SQL_NOW}) - julianday(MIN(cc.created_at))) * 1440 AS waiting_minutes
     FROM cleaning_checklist cc
     JOIN units u ON u.id = cc.unit_id
     WHERE cc.is_done = 0
       AND u.type IN (${placeholders(types.length)})
     GROUP BY u.id
     HAVING waiting_minutes > ?
     ORDER BY waiting_minutes DESC
     LIMIT ${MAX_PER_KIND}`
  )
    .bind(...types, CLEANING_SLA_MINUTES)
    .all<SlaRow>()

  for (const row of overdue) {
    out.push({
      id: `sla:${row.unit_id}:${row.waiting_since}`,
      kind: 'sla',
      title: `Уборка просрочена — ${row.unit_name}`,
      detail: `ждёт ${elapsed(row.waiting_minutes)}, осталось пунктов: ${row.pending}`,
      href: '/cleaning',
      at: row.waiting_since,
    })
  }

  // ── 2. Someone on the waitlist can now be placed ────────────────────────
  if (isAdmin) {
    const { results: matches } = await c.env.DB.prepare(
      `WITH candidates AS (
         SELECT w.id, w.guest_name, w.guest_phone, w.unit_type, w.date_from, w.date_to,
                w.created_at,
                (SELECT u.name FROM units u WHERE u.id = w.unit_id) AS unit_name,
                (SELECT COUNT(*)
                   FROM units u
                  WHERE u.type = w.unit_type
                    AND (w.unit_id IS NULL OR u.id = w.unit_id)
                    -- Free for the whole requested span: half-open, so a stay
                    -- ending on their arrival day does not block them.
                    AND NOT EXISTS (
                      SELECT 1 FROM bookings b
                       WHERE b.unit_id = u.id
                         AND b.status <> 'free'
                         AND date(b.date_from) < date(w.date_to)
                         AND date(b.date_to)   > date(w.date_from)
                    )
                ) AS free_units
           FROM waitlist w
          WHERE w.status = 'open'
            -- Dates already past are stale, not a match worth interrupting for.
            AND date(w.date_to) > ${SQL_TODAY}
       )
       SELECT * FROM candidates WHERE free_units > 0
        ORDER BY created_at
        LIMIT ${MAX_PER_KIND}`
    ).all<WaitlistRow>()

    for (const row of matches) {
      const where = row.unit_name
        ? `«${row.unit_name}»`
        : `${UNIT_WORDS[row.unit_type].toLowerCase()} (свободно: ${row.free_units})`
      out.push({
        id: `waitlist:${row.id}`,
        kind: 'waitlist',
        title: `Освободилось для листа ожидания — ${row.guest_name}`,
        detail: `${where}, ${row.date_from.slice(0, 10)} — ${row.date_to.slice(0, 10)}`,
        href: '/waitlist',
        at: row.created_at,
      })
    }
  }

  // ── 3. A booking made by someone else ──────────────────────────────────
  // Read from the audit log: bookings themselves do not record who created
  // them, and the log already does, immutably.
  if (isAdmin) {
    const { results: madeByOthers } = await c.env.DB.prepare(
      `SELECT a.id AS audit_id, a.created_at, su.name AS staff_name,
              a.entity_id AS booking_id, b.guest_name,
              u.id AS unit_id, u.name AS unit_name, u.type AS unit_type
         FROM audit_log a
         JOIN staff_users su ON su.id = a.staff_user_id
         LEFT JOIN bookings b ON b.id = a.entity_id
         LEFT JOIN units u ON u.id = b.unit_id
        WHERE a.entity = 'bookings'
          AND a.action IN ('booking.create', 'booking.quick')
          AND a.staff_user_id IS NOT NULL
          AND a.staff_user_id <> ?
          AND datetime(a.created_at) >= datetime(${SQL_NOW}, '-${BOOKING_WINDOW_HOURS} hours')
          -- A booking since cancelled is not news any more.
          AND b.id IS NOT NULL AND b.status <> 'free'
        ORDER BY a.created_at DESC
        LIMIT ${MAX_PER_KIND}`
    )
      .bind(staff.sub)
      .all<BookingRow>()

    for (const row of madeByOthers) {
      out.push({
        id: `booking:${row.audit_id}`,
        kind: 'booking',
        title: `Новая бронь — ${row.unit_name ?? 'объект'}`,
        detail: `${row.staff_name ?? 'Сотрудник'} забронировал для «${row.guest_name ?? '—'}»`,
        href: row.unit_id ? unitHref(row.unit_id, row.unit_type) : '/rooms',
        at: row.created_at,
      })
    }
  }

  // Newest first, so the banner leads with what just happened.
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return c.json({
    sla_minutes: CLEANING_SLA_MINUTES,
    booking_window_hours: BOOKING_WINDOW_HOURS,
    alerts: out,
  })
})

export default alerts