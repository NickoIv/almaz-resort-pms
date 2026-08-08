import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from './lib/auth'
import { buildDigest, loadChannel, loadSettings } from './lib/notifications'
import { deliverDigest } from './lib/notify'
import analyticsRoutes from './routes/analytics'
import authRoutes from './routes/auth'
import unitRoutes from './routes/units'
import bookingRoutes from './routes/bookings'
import cleaningRoutes from './routes/cleaning'
import guestRoutes from './routes/guests'
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
app.use('/api/guests/*', requireAuth)

app.route('/api/units', unitRoutes)
app.route('/api/bookings', bookingRoutes)
app.route('/api/cleaning', cleaningRoutes)
app.route('/api/analytics', analyticsRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/guests', guestRoutes)

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
 * Builds the digest and posts it to whichever channel the admin selected
 * (WhatsApp by default); stays silent when there is nothing to report, so the
 * group is not pinged for an empty day.
 */
async function scheduled(_event: ScheduledController, env: Bindings): Promise<void> {
  try {
    const settings = await loadSettings(env.DB)
    const digest = await buildDigest(env.DB, settings)

    if (!digest) {
      console.log('scheduled: nothing to report')
      return
    }

    const channel = await loadChannel(env.DB)
    const results = await deliverDigest(env, channel, digest)

    for (const result of results) {
      if (result.sent) console.log(`scheduled: sent via ${result.channel}`)
      else console.warn(`scheduled: ${result.channel} not sent — ${result.error}`)
    }
  } catch (error) {
    // Never throw out of a cron run — a failed send must not retry-storm.
    console.error('scheduled: digest failed', error)
  }
}

export default {
  fetch: app.fetch,
  scheduled,
}