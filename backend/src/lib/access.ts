import { HTTPException } from 'hono/http-exception'
import { RESTAURANT_UNIT_TYPES, type Role, type UnitType } from '../types'

/**
 * Which unit types each role may touch:
 *  - admin        — everything
 *  - housekeeper  — rooms only (cleaning checklists)
 *  - waiter       — restaurant / recreation units only
 */
export function allowedUnitTypes(role: Role): UnitType[] {
  switch (role) {
    case 'admin':
      return ['room', ...RESTAURANT_UNIT_TYPES]
    case 'housekeeper':
      return ['room']
    case 'waiter':
      return [...RESTAURANT_UNIT_TYPES]
  }
}

/** Intersects a requested `?type=` filter with what the role is allowed to see. */
export function resolveTypeFilter(role: Role, requested: string | undefined): UnitType[] {
  const allowed = allowedUnitTypes(role)
  if (!requested) return allowed

  const wanted = requested
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean) as UnitType[]

  const resolved = wanted.filter((t) => allowed.includes(t))
  if (resolved.length === 0) {
    throw new HTTPException(403, { message: 'Your role has no access to these unit types' })
  }
  return resolved
}

export function assertUnitTypeAllowed(role: Role, type: UnitType): void {
  if (!allowedUnitTypes(role).includes(type)) {
    throw new HTTPException(403, { message: 'Your role has no access to this unit' })
  }
}

/** Only the admin sees money. */
export function canSeeMoney(role: Role): boolean {
  return role === 'admin'
}

/** Builds `?, ?, ?` for an IN clause. */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ')
}