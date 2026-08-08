import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sign } from 'hono/jwt'
import { requireAuth, TOKEN_TTL_SECONDS } from '../lib/auth'
import { readJson } from '../lib/body'
import { verifyPin } from '../lib/pin'
import { writeAudit } from '../lib/audit'
import type { AppEnv, Role } from '../types'

type StaffRow = {
  id: number
  name: string
  phone: string
  role: Role
  pin_code_hash: string
}

/** Strips spaces, dashes and brackets so "+7 (777) 111-22-33" matches "+77771112233". */
function normalizePhone(phone: string): string {
  return phone.replace(/[\s()-]/g, '')
}

const auth = new Hono<AppEnv>()

auth.post('/login', async (c) => {
  const body = await readJson<{ phone: string; pin: string }>(c)
  const phone = normalizePhone(String(body.phone ?? ''))
  const pin = String(body.pin ?? '')

  if (!phone || !pin) {
    throw new HTTPException(400, { message: 'Phone and PIN are required' })
  }

  const staff = await c.env.DB.prepare(
    'SELECT id, name, phone, role, pin_code_hash FROM staff_users WHERE phone = ?'
  )
    .bind(phone)
    .first<StaffRow>()

  // Same response whether the phone is unknown or the PIN is wrong, so the
  // endpoint cannot be used to enumerate staff phone numbers.
  if (!staff || !(await verifyPin(pin, staff.pin_code_hash))) {
    throw new HTTPException(401, { message: 'Invalid phone or PIN' })
  }

  const payload = {
    sub: staff.id,
    name: staff.name,
    phone: staff.phone,
    role: staff.role,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  }

  const token = await sign(payload, c.env.JWT_SECRET)
  await writeAudit(c.env.DB, staff.id, 'login', 'staff_users', staff.id)

  return c.json({
    token,
    user: { id: staff.id, name: staff.name, phone: staff.phone, role: staff.role },
  })
})

auth.get('/me', requireAuth, (c) => {
  const staff = c.get('staff')
  return c.json({
    user: { id: staff.sub, name: staff.name, phone: staff.phone, role: staff.role },
  })
})

export default auth