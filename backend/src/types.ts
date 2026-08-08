export type Role = 'admin' | 'housekeeper' | 'waiter'

export type UnitType = 'room' | 'sunbed' | 'gazebo' | 'vip_gazebo'

export type BookingStatus = 'free' | 'booked' | 'occupied'

export type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  /** Wrangler secrets — absent until `wrangler secret put` has been run. */
  /** WhatsApp via Green API — the primary notification channel. */
  GREEN_API_INSTANCE_ID?: string
  GREEN_API_TOKEN?: string
  GREEN_API_CHAT_ID?: string
  /** Optional per-instance host, e.g. https://7103.api.greenapi.com */
  GREEN_API_URL?: string
  /** Telegram — kept as an optional secondary channel. */
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
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