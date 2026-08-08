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

/** Telegram sends HTML, so anything guest-supplied has to be escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

export type Digest = {
  sections: number
  text: string
}

/**
 * Builds the digest the cron job posts to Telegram.
 * Returns null when every enabled check came back empty — a quiet day should
 * not produce a message.
 */
export async function buildDigest(
  db: D1Database,
  settings: NotificationSettings
): Promise<Digest | null> {
  const parts: string[] = []
  let sections = 0

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
      sections++
      parts.push(
        `🛎 <b>Заезды сегодня (${results.length})</b>\n` +
          results
            .map(
              (row) =>
                `• ${escapeHtml(row.unit_name)} — ${escapeHtml(row.guest_name)}` +
                (row.guest_phone ? ` (${escapeHtml(row.guest_phone)})` : '')
            )
            .join('\n')
      )
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
      sections++
      parts.push(
        `🚪 <b>Выезды сегодня (${results.length})</b>\n` +
          results
            .map(
              (row) =>
                `• ${escapeHtml(row.unit_name)} — ${escapeHtml(row.guest_name)}` +
                (row.remaining > 0 ? ` · остаток ${formatMoney(row.remaining)}` : '')
            )
            .join('\n')
      )
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
      sections++
      parts.push(
        `🧹 <b>Просрочена уборка (${results.length})</b>\n` +
          results
            .map((row) => `• ${escapeHtml(row.name)} — осталось ${row.pending} пунктов`)
            .join('\n')
      )
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
      sections++
      const total = results.reduce((sum, row) => sum + row.remaining, 0)
      parts.push(
        `💰 <b>Не внесена доплата (${results.length})</b>\n` +
          results
            .map(
              (row) =>
                `• ${escapeHtml(row.unit_name)} — ${escapeHtml(row.guest_name)}: ` +
                `${formatMoney(row.remaining)}`
            )
            .join('\n') +
          `\n<i>Итого к доплате: ${formatMoney(total)}</i>`
      )
    }
  }

  if (sections === 0) return null

  return {
    sections,
    text: `<b>Almaz Resort PMS</b> · сводка на ${today}\n\n${parts.join('\n\n')}`,
  }
}