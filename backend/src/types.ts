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
  /**
   * Web Push (VAPID). Generated once with `node vapid-keys.mjs` and stored as
   * secrets; the public half is served to the browser by GET /api/push/key.
   * Rotating them invalidates every existing subscription, so staff would have
   * to switch notifications on again — see lib/webpush.ts.
   */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** Contact a push service can use to reach the operator, e.g. `mailto:…`. */
  VAPID_SUBJECT?: string
  /**
   * Where daily backups go. KV works on the free plan with no card; R2 needs
   * enabling in the dashboard first. Whichever is bound gets used — see
   * lib/backup-store.ts. With neither, the scheduled backup skips and the
   * manual export/import still works.
   */
  BACKUPS?: KVNamespace
  BACKUPS_R2?: R2Bucket
  /**
   * Internal photo documentation. A separate namespace from BACKUPS on
   * purpose: photos must never crowd out the daily database snapshots.
   */
  PHOTOS?: KVNamespace
  /** Set at deploy time so a backup file records which build produced it. */
  APP_VERSION?: string
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