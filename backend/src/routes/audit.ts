import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import type { AppEnv } from '../types'

const audit = new Hono<AppEnv>()

// Who-changed-what is an owner's view.
audit.use('*', requireRole('admin'))

type AuditRow = {
  id: number
  staff_user_id: number | null
  staff_name: string | null
  staff_role: string | null
  action: string
  entity: string
  entity_id: number | null
  created_at: string
  /** Resolved from whichever table `entity` names, so the row reads on its own. */
  target: string | null
  guest_name: string | null
}

const MAX_LIMIT = 200

/**
 * GET /api/audit — the staff action log, newest first.
 *
 * Filters: `staff_id`, `entity`, `action` (prefix match, so "booking" catches
 * booking.create / booking.update:free / booking.payment), `from`, `to`.
 * Paged with `limit` and `offset`.
 */
audit.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, MAX_LIMIT)
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)

  const staffId = c.req.query('staff_id')
  const entity = c.req.query('entity')
  const action = c.req.query('action')
  const from = c.req.query('from')
  const to = c.req.query('to')

  const where: string[] = []
  const binds: unknown[] = []

  if (staffId) {
    if (!Number.isInteger(Number(staffId))) {
      throw new HTTPException(400, { message: 'staff_id must be a number' })
    }
    where.push('a.staff_user_id = ?')
    binds.push(Number(staffId))
  }
  if (entity) {
    where.push('a.entity = ?')
    binds.push(entity)
  }
  if (action) {
    where.push('a.action LIKE ?')
    binds.push(`${action}%`)
  }
  if (from) {
    where.push('date(a.created_at) >= date(?)')
    binds.push(from)
  }
  if (to) {
    where.push('date(a.created_at) <= date(?)')
    binds.push(to)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.staff_user_id, su.name AS staff_name, su.role AS staff_role,
            a.action, a.entity, a.entity_id, a.created_at,
            CASE a.entity
              WHEN 'bookings' THEN (
                SELECT u.name FROM bookings b JOIN units u ON u.id = b.unit_id WHERE b.id = a.entity_id
              )
              WHEN 'units' THEN (SELECT u.name FROM units u WHERE u.id = a.entity_id)
              WHEN 'cleaning_checklist' THEN (
                SELECT u.name FROM cleaning_checklist cc JOIN units u ON u.id = cc.unit_id
                WHERE cc.id = a.entity_id
              )
              WHEN 'booking_groups' THEN (SELECT g.name FROM booking_groups g WHERE g.id = a.entity_id)
              WHEN 'charges' THEN (SELECT ch.reason FROM charges ch WHERE ch.id = a.entity_id)
              ELSE NULL
            END AS target,
            CASE a.entity
              WHEN 'bookings' THEN (SELECT b.guest_name FROM bookings b WHERE b.id = a.entity_id)
              WHEN 'booking_groups' THEN (SELECT g.guest_name FROM booking_groups g WHERE g.id = a.entity_id)
              ELSE NULL
            END AS guest_name
     FROM audit_log a
     LEFT JOIN staff_users su ON su.id = a.staff_user_id
     ${whereSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all<AuditRow>()

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM audit_log a ${whereSql}`
  )
    .bind(...binds)
    .first<{ total: number }>()

  return c.json({
    total: totalRow?.total ?? 0,
    limit,
    offset,
    entries: results,
  })
})

/** GET /api/audit/filters — the values actually present, for the filter UI. */
audit.get('/filters', async (c) => {
  const { results: actions } = await c.env.DB.prepare(
    `SELECT DISTINCT
       CASE WHEN instr(action, '.') > 0
            THEN substr(action, 1, instr(action, '.') - 1)
            ELSE action END AS prefix
     FROM audit_log ORDER BY prefix`
  ).all<{ prefix: string }>()

  const { results: staff } = await c.env.DB.prepare(
    `SELECT su.id, su.name, su.role
     FROM staff_users su
     WHERE EXISTS (SELECT 1 FROM audit_log a WHERE a.staff_user_id = su.id)
     ORDER BY su.name`
  ).all<{ id: number; name: string; role: string }>()

  return c.json({ actions: actions.map((row) => row.prefix), staff })
})

export default audit
