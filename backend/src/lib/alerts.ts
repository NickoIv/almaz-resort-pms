import { allowedUnitTypes, placeholders } from './access'
import { CLEANING_SLA_MINUTES } from './cleaning'
import { arrivalOf, daysLeft, noticeDue } from './migration-notice'
import { SQL_NOW, SQL_TODAY } from './time'
import type { Role, UnitType } from '../types'

/**
 * Things a member of staff should be told about without going looking.
 *
 * This lives in lib rather than in the route because it now has two callers:
 * the alert bell polls it through `GET /api/alerts`, and the push sweep runs it
 * per person to decide what to send to their phone. Keeping one computation is
 * the whole point — a notification that told a housekeeper about something her
 * own screen does not show would be worse than no notification at all.
 *
 * Role scoping stays on the server, like everywhere else: a housekeeper's poll
 * must not carry a booking she is not allowed to see, not even for the client
 * to filter out. **Every role gets something**, but not the same things — the
 * set is derived from `allowedUnitTypes` and from what the role can act on.
 *
 * Money stays out of it entirely. `canSeeMoney` allows only the admin, so there
 * is no alert about an unpaid balance; an alert is a poor place to route around
 * an access rule.
 *
 * Every alert carries a **stable id**. The client remembers which ids it has
 * announced and which the user dismissed; the push sweep remembers which it has
 * already sent. So an alert fires once when it appears and then stays quiet
 * while it remains outstanding. The ids encode what makes an event new:
 *
 *   sla:<unit>:<since>   — a unit dirtied again is a different wait, so the
 *                          timestamp is part of the id
 *   noshow:<booking>:<date> — an arrival that did not happen; the date is in
 *                          the id so moving the booking makes it a new arrival
 *   waitlist:<entry>     — one guest waiting, however often a unit frees and
 *                          fills again while they wait
 *   booking:<audit row>  — audit rows are append-only, so the id is unique
 *                          per booking actually created
 */

/** How far back a colleague's booking is still worth announcing. */
export const BOOKING_WINDOW_HOURS = 8

/**
 * How far ahead an arrival at a recreation unit is worth announcing.
 *
 * An hour is roughly how long before guests arrive a gazebo can still be
 * prepared. Much earlier and the alert is noted and forgotten; much later and
 * there is nothing to be done with it.
 */
export const ARRIVAL_WINDOW_MINUTES = 60

/** Cap per category, so a quiet client cannot be handed a thousand alerts. */
const MAX_PER_KIND = 25

export type AlertKind = 'sla' | 'waitlist' | 'booking' | 'upcoming' | 'noshow' | 'migration'

export type Alert = {
  id: string
  kind: AlertKind
  title: string
  detail: string
  /** Where to go to act on it. */
  href: string
  /** Almaty wall-clock, for ordering and for showing how long it has waited. */
  at: string
}

/** Who the alerts are for. Just the fields needed, so the cron can synthesise it. */
export type AlertAudience = {
  id: number
  role: Role
}

type SlaRow = {
  unit_id: number
  unit_name: string
  unit_type: UnitType
  pending: number
  waiting_since: string
  waiting_minutes: number
}

type ArrivalRow = {
  id: number
  guest_name: string
  date_from: string
  unit_id: number
  unit_name: string
  unit_type: UnitType
  minutes_away: number
}

type NoShowRow = {
  id: number
  guest_name: string
  guest_phone: string | null
  date_from: string
  unit_id: number
  unit_name: string
  unit_type: UnitType
  days_late: number
}

type MigrationDueRow = {
  id: number
  guest_name: string
  guest_citizenship: string
  date_from: string
  /** The real arrival when this row is the continuation of a переселение. */
  arrived_on: string | null
  unit_id: number
  unit_name: string
  unit_type: UnitType
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

/**
 * "вчера" / "3 дня назад".
 *
 * `elapsed` counts in minutes and hours, which is right for a cleaning breach
 * and wrong here: a guest three days late reads as «72 ч назад», which nobody
 * converts in their head.
 */
export function daysAgo(days: number): string {
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  const last = days % 10
  const teen = days % 100 >= 11 && days % 100 <= 14
  const word = teen || last === 0 || last >= 5 ? 'дней' : last === 1 ? 'день' : 'дня'
  return `${days} ${word} назад`
}

export function elapsed(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  if (safe < 60) return `${safe} мин`
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`
}

export async function computeAlerts(db: D1Database, audience: AlertAudience): Promise<Alert[]> {
  const types = allowedUnitTypes(audience.role)
  const isAdmin = audience.role === 'admin'
  const out: Alert[] = []

  // Almaty's day, asked of the database so every deadline below is counted from
  // the same one the rest of the app uses.
  const todayRow = await db.prepare(`SELECT ${SQL_TODAY} AS today`).first<{ today: string }>()
  const todayIso = todayRow?.today ?? new Date().toISOString().slice(0, 10)

  // ── 1. Cleaning past the SLA ────────────────────────────────────────────
  // Same shape the cleaning page computes, filtered to the breaches only.
  const { results: overdue } = await db
    .prepare(
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

  // ── 2. Guests due shortly at a recreation unit ─────────────────────────
  //
  // Recreation units are sold by the hour, so "starts at 14:00" is a real
  // moment someone has to prepare for — unlike a room, which is sold by night
  // and whose date_from carries no time at all. That is why this is scoped to
  // the restaurant types rather than to everything the role may see.
  const hourly = types.filter((type) => type !== 'room')
  if (hourly.length > 0) {
    const { results: arrivals } = await db
      .prepare(
        `SELECT b.id, b.guest_name, b.date_from,
                u.id AS unit_id, u.name AS unit_name, u.type AS unit_type,
                (julianday(datetime(b.date_from)) - julianday(${SQL_NOW})) * 1440
                  AS minutes_away
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
          WHERE b.status <> 'free'
            AND u.type IN (${placeholders(hourly.length)})
            AND datetime(b.date_from) > ${SQL_NOW}
            AND datetime(b.date_from) <= datetime(${SQL_NOW}, '+${ARRIVAL_WINDOW_MINUTES} minutes')
          ORDER BY b.date_from
          LIMIT ${MAX_PER_KIND}`
      )
      .bind(...hourly)
      .all<ArrivalRow>()

    for (const row of arrivals) {
      out.push({
        // One booking is one arrival, so the booking id alone is enough to make
        // this fire once. Moving the booking to a new time makes a new id
        // pointless — it is the same arrival — and re-announcing it would be
        // wrong anyway.
        id: `upcoming:${row.id}`,
        kind: 'upcoming',
        title: `Скоро гости — ${row.unit_name}`,
        detail: `через ${elapsed(row.minutes_away)}, ${row.guest_name}`,
        href: unitHref(row.unit_id, row.unit_type),
        // Ordered by when the alert became relevant, like the others, rather
        // than by the arrival time itself.
        at: row.date_from,
      })
    }
  }

  // ── 3. A guest who never arrived ────────────────────────────────────────
  //
  // A chain PMS calls this the night audit and cancels the booking outright.
  // Fourteen rooms do not want that: a guest whose flight was delayed is not a
  // row to delete unasked, and the only person who can tell the difference is
  // the one at the desk. So this says so and leaves the decision alone.
  //
  // What it prevents is real: a booking that stays `booked` after its arrival
  // day holds the room against the calendar, counts in «Начислено по броням»
  // and quietly turns into a night that was never sold and never released.
  //
  // Rooms only — a recreation unit's booking is hours long and is over by the
  // evening; there is nothing to chase.
  if (isAdmin) {
    const { results: noShows } = await db
      .prepare(
        `SELECT b.id, b.guest_name, b.guest_phone, b.date_from,
                u.id AS unit_id, u.name AS unit_name, u.type AS unit_type,
                CAST(julianday(${SQL_TODAY}) - julianday(date(b.date_from)) AS INTEGER) AS days_late
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
          WHERE b.status = 'booked'
            AND u.type = 'room'
            AND date(b.date_from) < ${SQL_TODAY}
            -- A fortnight back, no further. Without a floor the very first
            -- sweep after this shipped would announce every booking ever left
            -- half-finished, which is history, not news.
            AND date(b.date_from) >= date(${SQL_TODAY}, '-14 days')
          ORDER BY b.date_from
          LIMIT ${MAX_PER_KIND}`
      )
      .all<NoShowRow>()

    for (const row of noShows) {
      out.push({
        // The arrival date is part of the id: moving the booking to new dates
        // makes it a different arrival, and one that has not been missed yet.
        id: `noshow:${row.id}:${row.date_from.slice(0, 10)}`,
        kind: 'noshow',
        title: `Гость не заехал — ${row.unit_name}`,
        detail:
          `${row.guest_name} · заезд был ${row.date_from.slice(0, 10)}, ` +
          `${daysAgo(row.days_late)} — заселить или закрыть бронь`,
        href: unitHref(row.unit_id, row.unit_type),
        at: row.date_from,
      })
    }
  }

  // ── 4. A foreign guest the migration service has not been told about ────
  //
  // Kazakhstan gives the receiving party three days from arrival to notify,
  // through eQonaq or the visa-migration portal, and fines a hotel that misses
  // it. Nothing else in the app watches a legal clock, so this one is worth the
  // interruption.
  //
  // Only rooms, and only where a citizenship was actually recorded and is not
  // Kazakhstan. **An empty citizenship is not treated as foreign** — most
  // guests here are Kazakh, and guessing would raise a false deadline on nine
  // bookings in ten. The Миграционный учёт page lists the unrecorded ones
  // separately so silence cannot hide a real one either.
  if (isAdmin) {
    const { results: dueNotices } = await db
      .prepare(
        `SELECT b.id, b.guest_name, b.guest_citizenship, b.date_from, b.arrived_on,
                u.id AS unit_id, u.name AS unit_name, u.type AS unit_type
           FROM bookings b
           JOIN units u ON u.id = b.unit_id
          WHERE b.status <> 'free'
            AND u.type = 'room'
            AND b.migration_notified_at IS NULL
            AND b.guest_citizenship IS NOT NULL
            AND upper(trim(b.guest_citizenship)) <> 'KZ'
            AND date(COALESCE(b.arrived_on, b.date_from)) <= ${SQL_TODAY}
            AND date(COALESCE(b.arrived_on, b.date_from)) >= date(${SQL_TODAY}, '-30 days')
          ORDER BY b.date_from
          LIMIT ${MAX_PER_KIND}`
      )
      .all<MigrationDueRow>()

    for (const row of dueNotices) {
      // The arrival the clock runs from — not this row's start date, which is
      // today for a guest who was moved to another room this morning. Reading
      // date_from there would quietly grant three fresh days.
      const arrival = arrivalOf(row)
      const due = noticeDue(arrival)
      const left = daysLeft(arrival, todayIso)
      out.push({
        // The arrival date is in the id for the same reason as a no-show: moved
        // dates are a different arrival with a different deadline.
        id: `migration:${row.id}:${arrival}`,
        kind: 'migration',
        title:
          left < 0
            ? `Миграционный учёт просрочен — ${row.unit_name}`
            : `Уведомить миграционную службу — ${row.unit_name}`,
        detail:
          `${row.guest_name}, ${row.guest_citizenship} · ` +
          (left < 0 ? `срок истёк ${due}` : left === 0 ? `сегодня последний день (${due})` : `до ${due}`),
        href: '/migration',
        at: arrival,
      })
    }
  }

  // ── 5. Someone on the waitlist can now be placed ────────────────────────
  if (isAdmin) {
    const { results: matches } = await db
      .prepare(
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
      )
      .all<WaitlistRow>()

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

  // ── 4. A booking made by someone else ──────────────────────────────────
  // Read from the audit log: bookings themselves do not record who created
  // them, and the log already does, immutably.
  if (isAdmin) {
    const { results: madeByOthers } = await db
      .prepare(
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
      .bind(audience.id)
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

  return out
}
