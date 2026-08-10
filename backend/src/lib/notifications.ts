import { chargesSumSql } from './money'
import { SQL_NOW, SQL_TODAY } from './time'

export type NotificationKey =
  | 'notify_checkins'
  | 'notify_checkouts'
  | 'notify_cleaning'
  | 'notify_unpaid'

export const NOTIFICATION_KEYS: NotificationKey[] = [
  'notify_checkins',
  'notify_checkouts',
  'notify_cleaning',
  'notify_unpaid',
]

export type NotificationSettings = Record<NotificationKey, boolean>

export const DEFAULT_SETTINGS: NotificationSettings = {
  notify_checkins: true,
  notify_checkouts: true,
  notify_cleaning: true,
  notify_unpaid: true,
}

/** Where the digest goes. Telegram is retained as a secondary channel. */
export type NotifyChannel = 'whatsapp' | 'telegram' | 'both'

export const NOTIFY_CHANNELS: NotifyChannel[] = ['whatsapp', 'telegram', 'both']

export const DEFAULT_CHANNEL: NotifyChannel = 'whatsapp'

/**
 * Free-text settings, with the value used when the row is missing.
 * Kept alongside the toggles so the settings endpoint has one shape.
 */
export const TEXT_SETTINGS = {
  hotel_name: 'Taura',
  /** Address / phone / BIN line printed under the name on a receipt. */
  hotel_details: 'ул. Алма-Арасан, 4а, Алматы',
  reviews_2gis_url:
    'https://2gis.kz/almaty/geo/9429940001542859/76.908229,43.126376',
  reviews_google_url: '',

  /*
   * Legal details for the invoice.
   *
   * All empty by default, and the invoice omits any line that is still empty
   * rather than printing a placeholder. An invoice is a document someone may
   * put into their own accounts: a fabricated BIN or a bank account nobody
   * checked is worse than a missing line, because a missing line is obvious and
   * a wrong one is not.
   *
   * No migration adds these — `loadTextSettings` falls back to the default for
   * any key with no row, so an unset key is simply the default.
   */

  /** Legal entity, e.g. «ТОО "Таура"» — the name money is owed to. */
  invoice_legal_name: '',
  /** БИН / ИИН. */
  invoice_tax_id: '',
  /** Registered address, when it differs from the one guests visit. */
  invoice_legal_address: '',
  /** Phone and e-mail for billing questions. */
  invoice_contact: '',
  /** Bank, IBAN and BIC, as one block; printed verbatim. */
  invoice_bank: '',
  /** Payment terms, printed at the foot. */
  invoice_terms: '',
} as const

export type TextSettingKey = keyof typeof TEXT_SETTINGS

export const TEXT_SETTING_KEYS = Object.keys(TEXT_SETTINGS) as TextSettingKey[]

export async function loadTextSettings(
  db: D1Database
): Promise<Record<TextSettingKey, string>> {
  const { results } = await db
    .prepare('SELECT key, value FROM settings')
    .all<{ key: string; value: string }>()

  const values = { ...TEXT_SETTINGS } as Record<TextSettingKey, string>
  for (const row of results) {
    if (TEXT_SETTING_KEYS.includes(row.key as TextSettingKey)) {
      values[row.key as TextSettingKey] = row.value
    }
  }
  return values
}

export async function loadSettings(db: D1Database): Promise<NotificationSettings> {
  const { results } = await db
    .prepare('SELECT key, value FROM settings')
    .all<{ key: string; value: string }>()

  const settings = { ...DEFAULT_SETTINGS }
  for (const row of results) {
    if (NOTIFICATION_KEYS.includes(row.key as NotificationKey)) {
      settings[row.key as NotificationKey] = row.value === '1'
    }
  }
  return settings
}

export async function loadChannel(db: D1Database): Promise<NotifyChannel> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'notify_channel'")
    .first<{ value: string }>()

  return NOTIFY_CHANNELS.includes(row?.value as NotifyChannel)
    ? (row!.value as NotifyChannel)
    : DEFAULT_CHANNEL
}

/** Telegram parses HTML, so anything guest-supplied must be escaped for it. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatMoney(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₸`
}

type BookingLine = {
  unit_name: string
  unit_type: string
  guest_name: string
  guest_phone: string | null
  date_from: string
  date_to: string
  remaining: number
}

type CleaningLine = {
  name: string
  type: string
  pending: number
}

/**
 * The digest is built once as structured data and rendered per channel:
 * Telegram takes HTML, WhatsApp takes its own *bold* markup, and the Settings
 * preview takes plain text. Building HTML up front would mean un-escaping it
 * again for the other two — which is how double-escaped text creeps in.
 */
export type DigestSection = {
  icon: string
  title: string
  lines: string[]
  footer?: string
}

export type Digest = {
  date: string
  sections: DigestSection[]
}

/**
 * Builds the digest the scheduled job posts.
 * Returns null when every enabled check came back empty — a quiet day should
 * not produce a message.
 */
export async function buildDigest(
  db: D1Database,
  settings: NotificationSettings
): Promise<Digest | null> {
  const sections: DigestSection[] = []

  const todayRow = await db.prepare(`SELECT ${SQL_TODAY} AS today`).first<{ today: string }>()
  const today = todayRow?.today ?? new Date().toISOString().slice(0, 10)

  if (settings.notify_checkins) {
    const { results } = await db
      .prepare(
        `SELECT u.name AS unit_name, u.type AS unit_type, b.guest_name, b.guest_phone,
                b.date_from, b.date_to,
                (b.total_amount + ${chargesSumSql('b')} - b.prepaid_amount) AS remaining
         FROM bookings b JOIN units u ON u.id = b.unit_id
         WHERE b.status = 'booked' AND date(b.date_from) = date(${SQL_TODAY})
         ORDER BY u.type, u.name`
      )
      .all<BookingLine>()

    if (results.length > 0) {
      sections.push({
        icon: '🛎',
        title: `Заезды сегодня (${results.length})`,
        lines: results.map(
          (row) =>
            `${row.unit_name} — ${row.guest_name}` +
            (row.guest_phone ? ` (${row.guest_phone})` : '')
        ),
      })
    }
  }

  if (settings.notify_checkouts) {
    const { results } = await db
      .prepare(
        `SELECT u.name AS unit_name, u.type AS unit_type, b.guest_name, b.guest_phone,
                b.date_from, b.date_to,
                (b.total_amount + ${chargesSumSql('b')} - b.prepaid_amount) AS remaining
         FROM bookings b JOIN units u ON u.id = b.unit_id
         WHERE b.status = 'occupied' AND date(b.date_to) = date(${SQL_TODAY})
         ORDER BY u.type, u.name`
      )
      .all<BookingLine>()

    if (results.length > 0) {
      sections.push({
        icon: '🚪',
        title: `Выезды сегодня (${results.length})`,
        lines: results.map(
          (row) =>
            `${row.unit_name} — ${row.guest_name}` +
            (row.remaining > 0 ? ` · остаток ${formatMoney(row.remaining)}` : '')
        ),
      })
    }
  }

  if (settings.notify_cleaning) {
    // Overdue = the unit is free right now but its checklist is unfinished,
    // so nothing is stopping housekeeping from having done it.
    const { results } = await db
      .prepare(
        `SELECT u.name, u.type, COUNT(cc.id) AS pending
         FROM units u
         JOIN cleaning_checklist cc ON cc.unit_id = u.id AND cc.is_done = 0
         WHERE NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.unit_id = u.id AND b.status <> 'free'
             AND datetime(b.date_from) <= ${SQL_NOW} AND datetime(b.date_to) >= ${SQL_NOW}
         )
         GROUP BY u.id
         ORDER BY pending DESC, u.name`
      )
      .all<CleaningLine>()

    if (results.length > 0) {
      sections.push({
        icon: '🧹',
        title: `Просрочена уборка (${results.length})`,
        lines: results.map((row) => `${row.name} — осталось ${row.pending} пунктов`),
      })
    }
  }

  if (settings.notify_unpaid) {
    const { results } = await db
      .prepare(
        `SELECT u.name AS unit_name, u.type AS unit_type, b.guest_name, b.guest_phone,
                b.date_from, b.date_to,
                (b.total_amount + ${chargesSumSql('b')} - b.prepaid_amount) AS remaining
         FROM bookings b JOIN units u ON u.id = b.unit_id
         WHERE b.status <> 'free'
           AND (b.total_amount + ${chargesSumSql('b')} - b.prepaid_amount) > 0
           AND date(b.date_to) >= date(${SQL_TODAY})
         ORDER BY remaining DESC`
      )
      .all<BookingLine>()

    if (results.length > 0) {
      const total = results.reduce((sum, row) => sum + row.remaining, 0)
      sections.push({
        icon: '💰',
        title: `Не внесена доплата (${results.length})`,
        lines: results.map(
          (row) => `${row.unit_name} — ${row.guest_name}: ${formatMoney(row.remaining)}`
        ),
        footer: `Итого к доплате: ${formatMoney(total)}`,
      })
    }
  }

  if (sections.length === 0) return null
  return { date: today, sections }
}

const HEADING = 'Taura PMS'

/** Telegram: HTML markup, guest-supplied text escaped. */
export function renderTelegramHtml(digest: Digest): string {
  const blocks = digest.sections.map((section) => {
    const lines = section.lines.map((line) => `• ${escapeHtml(line)}`).join('\n')
    const footer = section.footer ? `\n<i>${escapeHtml(section.footer)}</i>` : ''
    return `${section.icon} <b>${escapeHtml(section.title)}</b>\n${lines}${footer}`
  })
  return `<b>${HEADING}</b> · сводка на ${digest.date}\n\n${blocks.join('\n\n')}`
}

/**
 * WhatsApp: *bold* / _italic_, and no markup language — so nothing is escaped
 * and a guest name goes out exactly as it was stored.
 */
export function renderWhatsApp(digest: Digest): string {
  const blocks = digest.sections.map((section) => {
    const lines = section.lines.map((line) => `• ${line}`).join('\n')
    const footer = section.footer ? `\n_${section.footer}_` : ''
    return `${section.icon} *${section.title}*\n${lines}${footer}`
  })
  return `*${HEADING}* · сводка на ${digest.date}\n\n${blocks.join('\n\n')}`
}

/** Plain text for the admin preview in Settings. */
export function renderPlain(digest: Digest): string {
  const blocks = digest.sections.map((section) => {
    const lines = section.lines.map((line) => `• ${line}`).join('\n')
    const footer = section.footer ? `\n${section.footer}` : ''
    return `${section.icon} ${section.title}\n${lines}${footer}`
  })
  return `${HEADING} · сводка на ${digest.date}\n\n${blocks.join('\n\n')}`
}