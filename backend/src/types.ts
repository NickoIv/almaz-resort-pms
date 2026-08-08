export type Role = 'admin' | 'housekeeper' | 'waiter'

export type UnitType = 'room' | 'sunbed' | 'gazebo' | 'vip_gazebo'

export type BookingStatus = 'free' | 'booked' | 'occupied'

export type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}

/** Payload embedded in the signed JWT handed to staff on login. */
export type JwtPayload = {
  sub: number
  name: string
  phone: string
  role: Role
  exp: number
}

export type Variables = {
  staff: JwtPayload
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }

/** Unit types a waiter is allowed to touch. */
export const RESTAURANT_UNIT_TYPES: UnitType[] = ['sunbed', 'gazebo', 'vip_gazebo']