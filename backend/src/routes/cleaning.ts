import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed, allowedUnitTypes, placeholders } from '../lib/access'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { resetChecklist } from '../lib/cleaning'
import { writeAudit } from '../lib/audit'
import type { AppEnv, UnitType } from '../types'

type ChecklistRow = {
  id: number
  unit_id: number
  booking_id: number | null
  item_name: string
  is_done: number
  updated_at: string | null
  updated_by: number | null
  updated_by_name: string | null
}

function serializeItem(row: ChecklistRow) {
  return {
    id: row.id,
    unit_id: row.unit_id,
    booking_id: row.booking_id,
    item_name: row.item_name,
    is_done: row.is_done === 1,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    updated_by_name: row.updated_by_name,
  }
}

const cleaning = new Hono<AppEnv>()

// Waiters have no housekeeping duties.
const canClean = requireRole('admin', 'housekeeper')

/** GET /api/cleaning — every unit with outstanding items ("what to clean today"). */
cleaning.get('/', canClean, async (c) => {
  const staff = c.get('staff')
  const types = allowedUnitTypes(staff.role)

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.type, u.name, u.category,
            COUNT(cc.id) AS total,
            SUM(CASE WHEN cc.is_done = 0 THEN 1 ELSE 0 END) AS pending
     FROM units u
     JOIN cleaning_checklist cc ON cc.unit_id = u.id
     WHERE u.type IN (${placeholders(types.length)})
     GROUP BY u.id
     HAVING pending > 0
     ORDER BY u.type, u.name`
  )
    .bind(...types)
    .all<{ id: number; type: UnitType; name: string; category: string | null; total: number; pending: number }>()

  return c.json(results)
})

/** GET /api/cleaning/unit/:unitId — the checklist for one unit. */
cleaning.get('/unit/:unitId', canClean, async (c) => {
  const staff = c.get('staff')
  const unitId = Number(c.req.param('unitId'))
  if (!Number.isInteger(unitId)) throw new HTTPException(400, { message: 'Invalid unit id' })

  const unit = await c.env.DB.prepare('SELECT id, type FROM units WHERE id = ?')
    .bind(unitId)
    .first<{ id: number; type: UnitType }>()
  if (!unit) throw new HTTPException(404, { message: 'Unit not found' })
  assertUnitTypeAllowed(staff.role, unit.type)

  const { results } = await c.env.DB.prepare(
    `SELECT cc.*, su.name AS updated_by_name
     FROM cleaning_checklist cc
     LEFT JOIN staff_users su ON su.id = cc.updated_by
     WHERE cc.unit_id = ?
     ORDER BY cc.id`
  )
    .bind(unitId)
    .all<ChecklistRow>()

  return c.json(results.map(serializeItem))
})

/** PATCH /api/cleaning/:itemId — tick or untick one item. */
cleaning.patch('/:itemId', canClean, async (c) => {
  const staff = c.get('staff')
  const itemId = Number(c.req.param('itemId'))
  if (!Number.isInteger(itemId)) throw new HTTPException(400, { message: 'Invalid item id' })

  const item = await c.env.DB.prepare(
    `SELECT cc.id, cc.unit_id, cc.is_done, u.type
     FROM cleaning_checklist cc JOIN units u ON u.id = cc.unit_id
     WHERE cc.id = ?`
  )
    .bind(itemId)
    .first<{ id: number; unit_id: number; is_done: number; type: UnitType }>()
  if (!item) throw new HTTPException(404, { message: 'Checklist item not found' })
  assertUnitTypeAllowed(staff.role, item.type)

  const body = await readJson<{ is_done: unknown }>(c)
  const isDone = body.is_done === undefined ? item.is_done === 0 : Boolean(body.is_done)

  const updated = await c.env.DB.prepare(
    `UPDATE cleaning_checklist
     SET is_done = ?, updated_at = datetime('now'), updated_by = ?
     WHERE id = ?
     RETURNING *`
  )
    .bind(isDone ? 1 : 0, staff.sub, itemId)
    .first<ChecklistRow>()

  await writeAudit(c.env.DB, staff.sub, `cleaning.${isDone ? 'done' : 'undone'}`, 'cleaning_checklist', itemId)
  return c.json(serializeItem({ ...updated!, updated_by_name: staff.name }))
})

/** POST /api/cleaning/unit/:unitId/reset — start a fresh checklist for a unit. */
cleaning.post('/unit/:unitId/reset', canClean, async (c) => {
  const staff = c.get('staff')
  const unitId = Number(c.req.param('unitId'))
  if (!Number.isInteger(unitId)) throw new HTTPException(400, { message: 'Invalid unit id' })

  const unit = await c.env.DB.prepare('SELECT id, type FROM units WHERE id = ?')
    .bind(unitId)
    .first<{ id: number; type: UnitType }>()
  if (!unit) throw new HTTPException(404, { message: 'Unit not found' })
  assertUnitTypeAllowed(staff.role, unit.type)

  await resetChecklist(c.env.DB, unitId, unit.type, null)
  await writeAudit(c.env.DB, staff.sub, 'cleaning.reset', 'units', unitId)

  const { results } = await c.env.DB.prepare(
    'SELECT cc.*, NULL AS updated_by_name FROM cleaning_checklist cc WHERE cc.unit_id = ? ORDER BY cc.id'
  )
    .bind(unitId)
    .all<ChecklistRow>()

  return c.json(results.map(serializeItem))
})

export default cleaning