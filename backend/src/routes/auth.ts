import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sign } from 'hono/jwt'
import { requireAuth, TOKEN_TTL_SECONDS } from '../lib/auth'
import { readJson } from '../lib/body'
import { verifyPin } from '../lib/pin'
import { writeAudit } from '../lib/audit'
import { clearFailures, lockMessage, lockState, recordFailure } from '../lib/login-guard'
import { normalizePhone } from '../lib/phone'
import type { AppEnv, Role } from '../types'

type StaffRow = {
  id: number
  name: string
  phone: string
  role: Role
  pin_code_hash: string
  is_active: number
}

const auth = new Hono<AppEnv>()

auth.post('/login', async (c) => {
  const body = await readJson<{ phone: string; pin: string }>(c)
  const phone = normalizePhone(String(body.phone ?? ''))
  const pin = String(body.pin ?? '')

  if (!phone || !pin) {
    throw new HTTPException(400, { message: 'Phone and PIN are required' })
  }

  // Before the PIN is looked at, so a locked number costs a guesser one read
  // instead of a hash comparison, and so a correct guess arriving mid-lock
  // still yields nothing. See lib/login-guard for why this is keyed on the
  // phone as submitted rather than on an account.
  const lock = await lockState(c.env.DB, phone)
  if (lock.locked) {
    throw new HTTPException(429, { message: lockMessage(lock.minutesLeft) })
  }

  const staff = await c.env.DB.prepare(
    'SELECT id, name, phone, role, pin_code_hash, is_active FROM staff_users WHERE phone = ?'
  )
    .bind(phone)
    .first<StaffRow>()

  // Same response whether the phone is unknown or the PIN is wrong, so the
  // endpoint cannot be used to enumerate staff phone numbers.
  if (!staff || !(await verifyPin(pin, staff.pin_code_hash))) {
    const caused = await recordFailure(c.env.DB, phone)
    // The moment a lock starts, say so rather than giving a sixth identical
    // rejection — a person who mistyped needs to know why the next try will
    // fail too, and a script learns nothing it could not measure anyway.
    if (caused.locked) {
      throw new HTTPException(429, { message: lockMessage(caused.minutesLeft) })
    }
    throw new HTTPException(401, { message: 'Invalid phone or PIN' })
  }

  // Only told to someone who already proved they hold the right PIN, so this
  // still cannot be used to probe which phone numbers exist.
  if (staff.is_active !== 1) {
    await writeAudit(c.env.DB, staff.id, 'login.disabled', 'staff_users', staff.id)
    throw new HTTPException(403, {
      message: 'Учётная запись отключена. Обратитесь к администратору.',
    })
  }

  const payload = {
    sub: staff.id,
    name: staff.name,
    phone: staff.phone,
    role: staff.role,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  }

  const token = await sign(payload, c.env.JWT_SECRET)
  // Proving the PIN clears the run of failures: someone who finally remembers
  // it must not still be serving a lock earned on the way there.
  await clearFailures(c.env.DB, phone)
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