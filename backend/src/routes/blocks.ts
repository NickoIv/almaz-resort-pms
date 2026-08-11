import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed } from '../lib/access'
import { requireRole } from '../lib/auth'
import { writeAudit } from '../lib/audit'
import { readJson } from '../lib/body'
import {
  BLOCK_OVERLAP,
  BLOCK_REASON_LABELS,
  blockNeedsNote,
  isBlockReason,
  type UnitBlock,
} from '../lib/blocks'
import { cleanOptional } from '../lib/text'
import { SQL_NOW, SQL_TODAY } from '../lib/time'
import type { AppEnv, UnitType } from '../types'

const blocks = new Hono<AppEnv>()

// The waiter runs the recreation area and is the person who finds a broken
// топчан, so they may take one off sale — `assertUnitTypeAllowed` keeps them
// inside it. Housekeepers work from the cleaning list and never touch what is
// sellable.
const canBlock = requireRole('admin', 'waiter')

const SELECT = `
  SELECT b.id, b.unit_id, b.date_from, b.date_to, b.reason, b.note,
         b.created_at, b.created_by, su.name AS created_by_name,
         u.name AS unit_name, u.type AS unit_type
    FROM unit_blocks b
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN staff_users su ON su.id = b.created_by
`

async function loadUnit(db: D1Database, unitId: number) {
  const unit = await db
    .prepare('SELECT id, type, name FROM units WHERE id = ?')
    .bind(unitId)
    .first<{ id: number; type: UnitType; name: string }>()
  if (!unit) throw new HTTPException(404, { message: 'Объект не найден' })
  return unit
}

/**
 * GET /api/blocks?from=&to=&unit_id= — what is off sale, and why.
 *
 * Defaults to everything from today onwards: a block that has already expired
 * is history, and the question this list answers is «что нельзя продать».
 */
blocks.get('/', async (c) => {
  const staff = c.get('staff')
  const from = c.req.query('from') ?? null
  const to = c.req.query('to') ?? '9999-12-31'
  const unitId = c.req.query('unit_id')

  const conditions: string[] = []
  const binds: unknown[] = []

  if (unitId !== undefined) {
    const id = Number(unitId)
    if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Некорректный объект' })
    const unit = await loadUnit(c.env.DB, id)
    assertUnitTypeAllowed(staff.role, unit.type)
    conditions.push('b.unit_id = ?')
    binds.push(id)
  }

  if (from === null) {
    // Almaty's today, not the server's — an expired block is history, and the
    // question this list answers is «что нельзя продать».
    conditions.push(`date(b.date_to) > ${SQL_TODAY}`)
  } else {
    conditions.push('date(b.date_to) > date(?)')
    binds.push(from)
  }
  conditions.push('date(b.date_from) < date(?)')
  binds.push(to)

  const { results } = await c.env.DB.prepare(
    `${SELECT} WHERE ${conditions.join(' AND ')} ORDER BY b.date_from, u.name`
  )
    .bind(...binds)
    .all<UnitBlock & { unit_name: string; unit_type: UnitType }>()

  // Filtered in code rather than in SQL: `allowedUnitTypes` is one list and it
  // lives in lib/access, so a second copy of it here would be a second thing to
  // keep in step.
  const visible = results.filter((row) => {
    try {
      assertUnitTypeAllowed(staff.role, row.unit_type)
      return true
    } catch {
      return false
    }
  })

  return c.json(visible)
})

/**
 * POST /api/blocks — take an object off sale for a run of nights.
 *
 * Refuses to sit on top of a live booking. That is not squeamishness: the guest
 * is *in* the room, and the honest answer is to move them, which переселение now
 * does in two taps. Blocking over them would leave a stay the board no longer
 * has room to draw and a guest nobody has told.
 */
blocks.post('/', canBlock, async (c) => {
  const staff = c.get('staff')
  const body = await readJson(c)

  const unitId = Number(body.unit_id)
  const dateFrom = String(body.date_from ?? '').trim().slice(0, 10)
  const dateTo = String(body.date_to ?? '').trim().slice(0, 10)

  if (!Number.isInteger(unitId) || !dateFrom || !dateTo) {
    throw new HTTPException(400, { message: 'Укажите объект и даты' })
  }
  if (dateTo <= dateFrom) {
    throw new HTTPException(400, {
      message: 'Снять с продажи можно минимум на одну ночь — дата «по» это утро освобождения',
    })
  }
  if (!isBlockReason(body.reason)) {
    throw new HTTPException(400, {
      message: `Укажите причину: ${Object.values(BLOCK_REASON_LABELS).join(', ')}`,
    })
  }
  const note = cleanOptional(body.note, 300)
  if (blockNeedsNote(body.reason) && !note) {
    throw new HTTPException(400, { message: 'Для причины «Другое» опишите её текстом' })
  }

  const unit = await loadUnit(c.env.DB, unitId)
  assertUnitTypeAllowed(staff.role, unit.type)

  const booked = await c.env.DB.prepare(
    `SELECT id, guest_name FROM bookings
      WHERE unit_id = ? AND status <> 'free'
        AND datetime(date_from) < datetime(?) AND datetime(date_to) > datetime(?)
      ORDER BY date_from LIMIT 1`
  )
    .bind(unitId, dateTo, dateFrom)
    .first<{ id: number; guest_name: string }>()

  if (booked) {
    throw new HTTPException(409, {
      message:
        `На эти даты стоит бронь #${booked.id} — ${booked.guest_name}. ` +
        'Сначала переселите гостя или закройте бронь.',
    })
  }

  const overlapping = await c.env.DB.prepare(
    `SELECT id FROM unit_blocks WHERE unit_id = ? AND ${BLOCK_OVERLAP} LIMIT 1`
  )
    .bind(unitId, dateTo, dateFrom)
    .first<{ id: number }>()
  if (overlapping) {
    throw new HTTPException(409, { message: 'Эти даты уже сняты с продажи' })
  }

  const created = await c.env.DB.prepare(
    `INSERT INTO unit_blocks (unit_id, date_from, date_to, reason, note, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ${SQL_NOW}, ?)
     RETURNING id`
  )
    .bind(unitId, dateFrom, dateTo, body.reason, note, staff.sub)
    .first<{ id: number }>()

  // The object name rides in the action for the same reason it does on a
  // переселение: the journal has to read on its own, and «снят с продажи» is
  // meaningless without saying what was.
  await writeAudit(
    c.env.DB,
    staff.sub,
    `block.create:${body.reason}:${unit.name}`,
    'unit_blocks',
    created?.id ?? null
  )

  const row = await c.env.DB.prepare(`${SELECT} WHERE b.id = ?`).bind(created!.id).first()
  return c.json(row, 201)
})

/** DELETE /api/blocks/:id — the object is back on sale. */
blocks.delete('/:id', canBlock, async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Некорректная запись' })

  const existing = await c.env.DB.prepare(
    'SELECT b.id, b.reason, u.id AS unit_id, u.name AS unit_name, u.type AS unit_type FROM unit_blocks b JOIN units u ON u.id = b.unit_id WHERE b.id = ?'
  )
    .bind(id)
    .first<{ id: number; reason: string; unit_name: string; unit_type: UnitType }>()
  if (!existing) throw new HTTPException(404, { message: 'Запись не найдена' })
  assertUnitTypeAllowed(staff.role, existing.unit_type)

  await c.env.DB.prepare('DELETE FROM unit_blocks WHERE id = ?').bind(id).run()
  await writeAudit(c.env.DB, staff.sub, `block.delete:${existing.unit_name}`, 'unit_blocks', id)

  return c.json({ deleted: true })
})

export default blocks
