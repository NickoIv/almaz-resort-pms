import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { verify } from 'hono/jwt'
import type { AppEnv, JwtPayload, Role } from '../types'

/**
 * Verifies the bearer token and puts the staff payload on the context.
 * Every route below /api (except login) runs through this.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HTTPException(401, { message: 'Missing bearer token' })

  let payload: JwtPayload
  try {
    payload = (await verify(token, c.env.JWT_SECRET, 'HS256')) as unknown as JwtPayload
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }

  // Tokens live a day, so checking the flag only at login would leave a
  // disabled account working until this time tomorrow — which is not what
  // "disable" means to the admin who clicked it. One indexed lookup per
  // request is a fair price for revocation taking effect immediately.
  const account = await c.env.DB.prepare('SELECT is_active, role FROM staff_users WHERE id = ?')
    .bind(payload.sub)
    .first<{ is_active: number; role: Role }>()

  if (!account || account.is_active !== 1) {
    throw new HTTPException(403, { message: 'Учётная запись отключена' })
  }

  // Take the role from the database rather than the token, so a demotion
  // applies straight away instead of when the token happens to expire.
  c.set('staff', { ...payload, role: account.role })
  await next()
}

/** Restricts a route to the listed roles. Assumes requireAuth ran first. */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const staff = c.get('staff')
    if (!staff || !roles.includes(staff.role)) {
      throw new HTTPException(403, { message: 'Your role has no access to this resource' })
    }
    await next()
  }
}

/**
 * Token lifetime: a day.
 *
 * Twelve hours was «смена плюс запас», and it was the запас that was wrong: a
 * tab opened at the desk in the morning was dead by the evening shift, and one
 * left overnight met the next morning with an error rather than a PIN screen.
 * A day means one login per day at a fixed-ish hour instead of a second one
 * arriving mid-evening for no reason a person can see.
 *
 * It is not a security downgrade in the way a longer session usually is:
 * `requireAuth` re-reads `is_active` and the role from the database on **every**
 * request, so disabling an account or demoting someone takes effect at once and
 * does not wait for the token to lapse.
 */
export const TOKEN_TTL_SECONDS = 24 * 60 * 60