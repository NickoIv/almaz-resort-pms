import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { writeAudit } from '../lib/audit'
import {
  buildDigest,
  loadSettings,
  NOTIFICATION_KEYS,
  type NotificationKey,
} from '../lib/notifications'
import { sendTelegramMessage, TelegramNotConfigured } from '../lib/telegram'
import type { AppEnv } from '../types'

const settings = new Hono<AppEnv>()

// Settings are an admin concern only.
settings.use('*', requireRole('admin'))

/** GET /api/settings — current toggles plus whether Telegram is wired up. */
settings.get('/', async (c) => {
  const current = await loadSettings(c.env.DB)
  return c.json({
    notifications: current,
    telegram_configured: Boolean(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID),
  })
})

/** PUT /api/settings — update the toggles. */
settings.put('/', async (c) => {
  const staff = c.get('staff')
  const body = await readJson<Record<NotificationKey, boolean>>(c)

  const updates = NOTIFICATION_KEYS.filter((key) => body[key] !== undefined)
  if (updates.length === 0) {
    throw new HTTPException(400, { message: 'Нет ни одной известной настройки' })
  }

  await c.env.DB.batch(
    updates.map((key) =>
      c.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`
      ).bind(key, body[key] ? '1' : '0', staff.sub)
    )
  )

  await writeAudit(c.env.DB, staff.sub, 'settings.update', 'settings', null)

  return c.json({
    notifications: await loadSettings(c.env.DB),
    telegram_configured: Boolean(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID),
  })
})

/**
 * GET /api/settings/preview — the digest as it stands right now, without
 * sending anything. Lets an admin see what the cron job would post.
 */
settings.get('/preview', async (c) => {
  const digest = await buildDigest(c.env.DB, await loadSettings(c.env.DB))
  return c.json({
    empty: digest === null,
    sections: digest?.sections ?? 0,
    text: digest?.text ?? '',
  })
})

/** POST /api/settings/test-notification — send the digest to Telegram now. */
settings.post('/test-notification', async (c) => {
  const staff = c.get('staff')
  const digest = await buildDigest(c.env.DB, await loadSettings(c.env.DB))

  const text = digest
    ? `🔔 <i>Тестовая отправка</i>\n\n${digest.text}`
    : `🔔 <i>Тестовая отправка</i>\n\n<b>Almaz Resort PMS</b>\nСейчас сообщать не о чем — заездов, выездов, просроченной уборки и долгов нет.`

  try {
    await sendTelegramMessage(
      { botToken: c.env.TELEGRAM_BOT_TOKEN, chatId: c.env.TELEGRAM_CHAT_ID },
      text
    )
  } catch (error) {
    if (error instanceof TelegramNotConfigured) {
      throw new HTTPException(503, { message: error.message })
    }
    throw new HTTPException(502, {
      message: error instanceof Error ? error.message : 'Не удалось отправить сообщение',
    })
  }

  await writeAudit(c.env.DB, staff.sub, 'notification.test', 'settings', null)
  return c.json({ sent: true, sections: digest?.sections ?? 0 })
})

export default settings