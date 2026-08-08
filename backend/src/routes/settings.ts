import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { writeAudit } from '../lib/audit'
import {
  buildDigest,
  loadChannel,
  loadSettings,
  NOTIFICATION_KEYS,
  NOTIFY_CHANNELS,
  renderPlain,
  type NotificationKey,
  type NotifyChannel,
} from '../lib/notifications'
import { channelStatus, deliverDigest } from '../lib/notify'
import type { AppEnv, Bindings } from '../types'

const settings = new Hono<AppEnv>()

// Settings are an admin concern only.
settings.use('*', requireRole('admin'))

async function currentState(env: Bindings) {
  return {
    notifications: await loadSettings(env.DB),
    channel: await loadChannel(env.DB),
    ...channelStatus(env),
  }
}

/** GET /api/settings — toggles, chosen channel, and which channels are wired up. */
settings.get('/', async (c) => c.json(await currentState(c.env)))

/** PUT /api/settings — update the toggles and/or the delivery channel. */
settings.put('/', async (c) => {
  const staff = c.get('staff')
  const body = await readJson<Record<string, unknown>>(c)

  const toggleUpdates = NOTIFICATION_KEYS.filter((key) => body[key] !== undefined)
  const channel = body.channel as NotifyChannel | undefined

  if (channel !== undefined && !NOTIFY_CHANNELS.includes(channel)) {
    throw new HTTPException(400, {
      message: `channel must be one of: ${NOTIFY_CHANNELS.join(', ')}`,
    })
  }

  if (toggleUpdates.length === 0 && channel === undefined) {
    throw new HTTPException(400, { message: 'Нет ни одной известной настройки' })
  }

  const upsert = (key: string, value: string) =>
    c.env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    ).bind(key, value, staff.sub)

  const statements = toggleUpdates.map((key) =>
    upsert(key, (body[key as NotificationKey] as boolean) ? '1' : '0')
  )
  if (channel !== undefined) statements.push(upsert('notify_channel', channel))

  await c.env.DB.batch(statements)
  await writeAudit(c.env.DB, staff.sub, 'settings.update', 'settings', null)

  return c.json(await currentState(c.env))
})

/**
 * GET /api/settings/preview — the digest as it stands right now, as plain text,
 * without sending anything.
 */
settings.get('/preview', async (c) => {
  const digest = await buildDigest(c.env.DB, await loadSettings(c.env.DB))
  return c.json({
    empty: digest === null,
    sections: digest?.sections.length ?? 0,
    text: digest ? renderPlain(digest) : '',
  })
})

/** POST /api/settings/test-notification — send the digest now, to the chosen channel. */
settings.post('/test-notification', async (c) => {
  const staff = c.get('staff')
  const body = await readJson<{ channel: NotifyChannel }>(c)

  const channel =
    body.channel && NOTIFY_CHANNELS.includes(body.channel)
      ? body.channel
      : await loadChannel(c.env.DB)

  const digest = await buildDigest(c.env.DB, await loadSettings(c.env.DB))

  // Always send something on a test, even on a quiet day — the point is to
  // prove the channel works.
  const payload: Parameters<typeof deliverDigest>[2] = digest ?? {
    date: new Date().toISOString().slice(0, 10),
    sections: [
      {
        icon: '🔔',
        title: 'Тестовое сообщение',
        lines: ['Сейчас сообщать не о чем — заездов, выездов, уборки и долгов нет.'],
      },
    ],
  }

  const results = await deliverDigest(c.env, channel, payload)
  const anySent = results.some((r) => r.sent)

  await writeAudit(c.env.DB, staff.sub, `notification.test:${channel}`, 'settings', null)

  if (!anySent) {
    const reason = results.map((r) => `${r.channel}: ${r.error}`).join('; ')
    // 503 when nothing is configured yet, 502 when a configured channel failed.
    const unconfigured = results.every((r) => (r.error ?? '').includes('не настроен'))
    throw new HTTPException(unconfigured ? 503 : 502, { message: reason })
  }

  return c.json({
    sent: true,
    channel,
    sections: digest?.sections.length ?? 0,
    results,
  })
})

export default settings