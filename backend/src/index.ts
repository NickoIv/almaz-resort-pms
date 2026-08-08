import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from './lib/auth'
import { buildDigest, loadSettings } from './lib/notifications'
import { sendTelegramMessage, TelegramNotConfigured } from './lib/telegram'
import analyticsRoutes from './routes/analytics'
import authRoutes from './routes/auth'
import unitRoutes from './routes/units'
import bookingRoutes from './routes/bookings'
import cleaningRoutes from './routes/cleaning'
import settingsRoutes from './routes/settings'
import type { AppEnv, Bindings } from './types'

const app = new Hono<AppEnv>()

app.use('/api/*', cors())

app.get('/api/health', (c) => c.json({ ok: true, service: 'almaz-resort-pms-api' }))

// Public: login lives here, /auth/me guards itself.
app.route('/api/auth', authRoutes)

// Everything below requires a valid staff token.
app.use('/api/units/*', requireAuth)
app.use('/api/units', requireAuth)
app.use('/api/bookings/*', requireAuth)
app.use('/api/bookings', requireAuth)
app.use('/api/cleaning/*', requireAuth)
app.use('/api/cleaning', requireAuth)
app.use('/api/analytics/*', requireAuth)
app.use('/api/settings/*', requireAuth)
app.use('/api/settings', requireAuth)

app.route('/api/units', unitRoutes)
app.route('/api/bookings', bookingRoutes)
app.route('/api/cleaning', cleaningRoutes)
app.route('/api/analytics', analyticsRoutes)
app.route('/api/settings', settingsRoutes)

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error('Unhandled error', err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

/**
 * Cron handler — see the `[triggers]` block in wrangler.toml.
 * Builds the digest and posts it to Telegram; stays silent when there is
 * nothing to report, so the group is not pinged for an empty day.
 */
async function scheduled(_event: ScheduledController, env: Bindings): Promise<void> {
  try {
    const settings = await loadSettings(env.DB)
    const digest = await buildDigest(env.DB, settings)

    if (!digest) {
      console.log('scheduled: nothing to report')
      return
    }

    await sendTelegramMessage(
      { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID },
      digest.text
    )
    console.log(`scheduled: sent digest with ${digest.sections} section(s)`)
  } catch (error) {
    // Never throw out of a cron run — a failed send must not retry-storm.
    if (error instanceof TelegramNotConfigured) {
      console.warn('scheduled: Telegram secrets are not set, skipping')
      return
    }
    console.error('scheduled: digest failed', error)
  }
}

export default {
  fetch: app.fetch,
  scheduled,
}