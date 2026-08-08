import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed, allowedUnitTypes, placeholders } from '../lib/access'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { writeAudit } from '../lib/audit'
import { normalizePhone } from '../lib/phone'
import { cleanName, cleanOptional } from '../lib/text'
import { SQL_NOW, SQL_TODAY } from '../lib/time'
import type { AppEnv, UnitType } from '../types'

const waitlist = new Hono<AppEnv>()

const WAITLIST_STATUSES = ['open', 'placed', 'closed'] as const
type WaitlistStatus = (typeof WAITLIST_STATUSES)[number]

type WaitlistRow = {
  id: number
  guest_name: string
  guest_phone: string | null
  unit_type: UnitType
  unit_id: number | null
  unit_name: string | null
  date_from: string
  date_to: string
  note: string | null
  status: WaitlistStatus
  created_at: string
  created_by_name: string | null
}

const SELECT = `
  SELECT w.id, w.guest_name, w.guest_phone, w.unit_type, w.unit_id, u.name AS unit_name,
         w.date_from, w.date_to, w.note, w.status, w.created_at,
         su.name AS created_by_name
  FROM waitlist w
  LEFT JOIN units u ON u.id = w.unit_id
  LEFT JOIN staff_users su ON su.id = w.created_by
`

/**
 * Open waitlist entries whose dates overlap a window.
 *
 * Shared by the listing and by the reminder shown after a cancellation —
 * "these people wanted exactly these dates". Half-open comparison, so an entry
 * ending the day another starts is not treated as a clash.
 */
export async function findWaitlistMatches(
  db: D1Database,
  unitType: UnitType,
  dateFrom: string,
  dateTo: string,
  unitId: number | null
): Promise<WaitlistRow[]> {
  const { results } = await db
    .prepare(
      `${SELECT}
       WHERE w.status = 'open'
         AND w.unit_type = ?
         AND date(w.date_from) < date(?)
         AND date(w.date_to) > date(?)
         AND (w.unit_id IS NULL OR w.unit_id = ? OR ? IS NULL)
       ORDER BY w.created_at`
    )
    .bind(unitType, dateTo, dateFrom, unitId, unitId)
    .all<WaitlistRow>()

  return results
}

// Waiters take walk-ins, so they may add entries; only admins see the full list.
const canAdd = requireRole('admin', 'waiter')

/** GET /api/waitlist?status=open — admin only. */
waitlist.get('/', requireRole('admin'), async (c) => {
  const status = c.req.query('status')
  if (status && !WAITLIST_STATUSES.includes(status as WaitlistStatus)) {
    throw new HTTPException(400, { message: `status must be one of: ${WAITLIST_STATUSES.join(', ')}` })
  }

  const { results } = await c.env.DB.prepare(
    `${SELECT}
     ${status ? 'WHERE w.status = ?' : ''}
     ORDER BY (w.status = 'open') DESC, date(w.date_from)`
  )
    .bind(...(status ? [status] : []))
    .all<WaitlistRow>()

  // "Stale" = the requested dates are already in the past; shown so the list
  // can be tidied rather than silently accumulating.
  const todayRow = await c.env.DB.prepare(`SELECT ${SQL_TODAY} AS today`).first<{ today: string }>()
  const today = todayRow?.today ?? ''

  return c.json(
    results.map((row) => ({ ...row, is_stale: row.status === 'open' && row.date_to < today }))
  )
})

/** POST /api/waitlist */
waitlist.post('/', canAdd, async (c) => {
  const staff = c.get('staff')
  const body = await readJson(c)

  const guestName = cleanName(body.guest_name)
  const unitType = body.unit_type as UnitType
  const dateFrom = String(body.date_from ?? '').trim()
  const dateTo = String(body.date_to ?? '').trim()

  if (!guestName) throw new HTTPException(400, { message: 'Укажите имя гостя' })
  if (!dateFrom || !dateTo) throw new HTTPException(400, { message: 'Укажите даты' })
  if (dateTo < dateFrom) {
    throw new HTTPException(400, { message: 'date_to must not be earlier than date_from' })
  }

  assertUnitTypeAllowed(staff.role, unitType)

  // A preferred unit is optional, but if given it must be of the stated type.
  let unitId: number | null = null
  if (body.unit_id !== undefined && body.unit_id !== null) {
    unitId = Number(body.unit_id)
    const unit = await c.env.DB.prepare('SELECT id, type FROM units WHERE id = ?')
      .bind(unitId)
      .first<{ id: number; type: UnitType }>()
    if (!unit) throw new HTTPException(404, { message: 'Объект не найден' })
    if (unit.type !== unitType) {
      throw new HTTPException(400, { message: 'unit_id не соответствует unit_type' })
    }
  }

  const created = await c.env.DB.prepare(
    `INSERT INTO waitlist (guest_name, guest_phone, unit_type, unit_id, date_from, date_to, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  )
    .bind(
      guestName,
      normalizePhone(body.guest_phone) || null,
      unitType,
      unitId,
      dateFrom,
      dateTo,
      cleanOptional(body.note, 300),
      staff.sub
    )
    .first<{ id: number }>()

  await writeAudit(c.env.DB, staff.sub, 'waitlist.create', 'waitlist', created?.id ?? null)

  const row = await c.env.DB.prepare(`${SELECT} WHERE w.id = ?`)
    .bind(created?.id)
    .first<WaitlistRow>()
  return c.json(row, 201)
})

/** PATCH /api/waitlist/:id — mark placed or closed, or reopen. */
waitlist.patch('/:id', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid waitlist id' })

  const body = await readJson<{ status: WaitlistStatus }>(c)
  if (!WAITLIST_STATUSES.includes(body.status as WaitlistStatus)) {
    throw new HTTPException(400, { message: `status must be one of: ${WAITLIST_STATUSES.join(', ')}` })
  }

  const closing = body.status !== 'open'
  const updated = await c.env.DB.prepare(
    `UPDATE waitlist
     SET status = ?,
         closed_at = CASE WHEN ? THEN ${SQL_NOW} ELSE NULL END,
         closed_by = CASE WHEN ? THEN ? ELSE NULL END
     WHERE id = ?
     RETURNING id`
  )
    .bind(body.status, closing ? 1 : 0, closing ? 1 : 0, staff.sub, id)
    .first<{ id: number }>()

  if (!updated) throw new HTTPException(404, { message: 'Запись не найдена' })

  await writeAudit(c.env.DB, staff.sub, `waitlist.update:${body.status}`, 'waitlist', id)
  const row = await c.env.DB.prepare(`${SELECT} WHERE w.id = ?`).bind(id).first<WaitlistRow>()
  return c.json(row)
})

/**
 * GET /api/waitlist/matches?unit_type=&from=&to=&unit_id=
 * Who was waiting for these dates — used after a cancellation frees them up.
 */
waitlist.get('/matches', async (c) => {
  const staff = c.get('staff')
  const unitType = (c.req.query('unit_type') ?? 'room') as UnitType
  const from = c.req.query('from')
  const to = c.req.query('to')

  if (!from || !to) throw new HTTPException(400, { message: 'from and to are required' })
  if (!allowedUnitTypes(staff.role).includes(unitType)) {
    throw new HTTPException(403, { message: 'Your role has no access to this unit type' })
  }

  const unitId = c.req.query('unit_id') ? Number(c.req.query('unit_id')) : null
  return c.json(await findWaitlistMatches(c.env.DB, unitType, from, to, unitId))
})

/** GET /api/waitlist/summary — open-entry count, for a nav badge. */
waitlist.get('/summary', requireRole('admin'), async (c) => {
  const types = allowedUnitTypes(c.get('staff').role)
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS open FROM waitlist
     WHERE status = 'open' AND unit_type IN (${placeholders(types.length)})`
  )
    .bind(...types)
    .first<{ open: number }>()
  return c.json({ open: row?.open ?? 0 })
})

export default waitlist
