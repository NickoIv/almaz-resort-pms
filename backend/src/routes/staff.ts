import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { writeAudit } from '../lib/audit'
import { isPlausiblePhone, normalizePhone } from '../lib/phone'
import { hashPin } from '../lib/pin'
import { cleanName } from '../lib/text'
import type { AppEnv, Role } from '../types'

const staff = new Hono<AppEnv>()

// Managing who can log in is an owner's job.
staff.use('*', requireRole('admin'))

const ROLES: Role[] = ['admin', 'housekeeper', 'waiter']

type StaffRow = {
  id: number
  name: string
  phone: string
  role: Role
  is_active: number
}

/** The PIN hash must never leave the server, not even to an admin. */
function serialize(row: StaffRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role,
    is_active: row.is_active === 1,
  }
}

const SELECT = 'SELECT id, name, phone, role, is_active FROM staff_users'

function assertValidPin(pin: unknown): string {
  const value = String(pin ?? '')
  if (!/^\d{4,8}$/.test(value)) {
    throw new HTTPException(400, { message: 'PIN должен состоять из 4–8 цифр' })
  }
  return value
}

/** Guards against an admin locking everyone out of the system. */
async function assertNotLastActiveAdmin(
  db: D1Database,
  staffId: number,
  reason: string
): Promise<void> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM staff_users WHERE role = 'admin' AND is_active = 1 AND id <> ?"
    )
    .bind(staffId)
    .first<{ count: number }>()

  if ((row?.count ?? 0) === 0) {
    throw new HTTPException(409, { message: reason })
  }
}

/** GET /api/staff */
staff.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `${SELECT} ORDER BY is_active DESC, role, name`
  ).all<StaffRow>()
  return c.json(results.map(serialize))
})

/** POST /api/staff */
staff.post('/', async (c) => {
  const actor = c.get('staff')
  const body = await readJson(c)

  const name = cleanName(body.name)
  const phone = normalizePhone(body.phone)
  const role = body.role as Role
  const pin = assertValidPin(body.pin)

  if (!name) throw new HTTPException(400, { message: 'Укажите имя сотрудника' })
  if (!isPlausiblePhone(phone)) {
    throw new HTTPException(400, { message: 'Укажите корректный номер телефона' })
  }
  if (!ROLES.includes(role)) {
    throw new HTTPException(400, { message: `Роль должна быть одной из: ${ROLES.join(', ')}` })
  }

  const existing = await c.env.DB.prepare('SELECT id FROM staff_users WHERE phone = ?')
    .bind(phone)
    .first<{ id: number }>()
  if (existing) {
    throw new HTTPException(409, { message: 'Сотрудник с таким телефоном уже есть' })
  }

  const created = await c.env.DB.prepare(
    `INSERT INTO staff_users (name, phone, role, pin_code_hash, is_active)
     VALUES (?, ?, ?, ?, 1)
     RETURNING id, name, phone, role, is_active`
  )
    .bind(name, phone, role, await hashPin(pin))
    .first<StaffRow>()

  if (!created) throw new HTTPException(500, { message: 'Не удалось создать сотрудника' })

  await writeAudit(c.env.DB, actor.sub, `staff.create:${role}`, 'staff_users', created.id)
  return c.json(serialize(created), 201)
})

/**
 * PATCH /api/staff/:id — rename, change role, reset the PIN, or
 * disable/re-enable. Any subset of those in one call.
 */
staff.patch('/:id', async (c) => {
  const actor = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid staff id' })

  const existing = await c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id).first<StaffRow>()
  if (!existing) throw new HTTPException(404, { message: 'Сотрудник не найден' })

  const body = await readJson(c)
  const changes: string[] = []

  const name = body.name === undefined ? existing.name : cleanName(body.name)
  if (!name) throw new HTTPException(400, { message: 'Укажите имя сотрудника' })
  if (name !== existing.name) changes.push('name')

  const role = (body.role === undefined ? existing.role : body.role) as Role
  if (!ROLES.includes(role)) {
    throw new HTTPException(400, { message: `Роль должна быть одной из: ${ROLES.join(', ')}` })
  }
  if (role !== existing.role) changes.push(`role:${role}`)

  const isActive = body.is_active === undefined ? existing.is_active === 1 : Boolean(body.is_active)
  if (isActive !== (existing.is_active === 1)) changes.push(isActive ? 'enabled' : 'disabled')

  // You cannot switch off the seat you are sitting in, and the system must
  // always keep at least one admin who can still log in.
  const losingAdmin = existing.role === 'admin' && (role !== 'admin' || !isActive)
  if (losingAdmin) {
    if (id === actor.sub) {
      throw new HTTPException(409, {
        message: 'Нельзя отключить или понизить собственную учётную запись',
      })
    }
    await assertNotLastActiveAdmin(
      c.env.DB,
      id,
      'Это последний активный администратор — сначала назначьте другого'
    )
  }

  const pinHash = body.pin === undefined ? null : await hashPin(assertValidPin(body.pin))
  if (pinHash) changes.push('pin')

  if (changes.length === 0) return c.json(serialize(existing))

  const updated = await c.env.DB.prepare(
    `UPDATE staff_users
     SET name = ?, role = ?, is_active = ?, pin_code_hash = COALESCE(?, pin_code_hash)
     WHERE id = ?
     RETURNING id, name, phone, role, is_active`
  )
    .bind(name, role, isActive ? 1 : 0, pinHash, id)
    .first<StaffRow>()

  if (!updated) throw new HTTPException(500, { message: 'Не удалось обновить сотрудника' })

  // The action names what changed, so the journal is readable without a diff.
  await writeAudit(c.env.DB, actor.sub, `staff.update:${changes.join('+')}`, 'staff_users', id)
  return c.json(serialize(updated))
})

export default staff
