import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from './lib/auth'
import { backupFilename, exportAll } from './lib/backup'
import { backupStore, DAILY_PREFIX, pruneDaily } from './lib/backup-store'
import { buildDigest, loadChannel, loadSettings } from './lib/notifications'
import { deliverDigest, EXTERNAL_DELIVERY_ENABLED } from './lib/notify'
import alertRoutes from './routes/alerts'
import analyticsRoutes from './routes/analytics'
import auditRoutes from './routes/audit'
import authRoutes from './routes/auth'
import backupRoutes from './routes/backup'
import roomRoutes from './routes/rooms'
import unitRoutes from './routes/units'
import bookingRoutes from './routes/bookings'
import cleaningRoutes from './routes/cleaning'
import guestRoutes from './routes/guests'
import settingsRoutes from './routes/settings'
import photoRoutes from './routes/photos'
import staffRoutes from './routes/staff'
import waitlistRoutes from './routes/waitlist'
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
app.use('/api/audit', requireAuth)
app.use('/api/audit/*', requireAuth)
app.use('/api/staff', requireAuth)
app.use('/api/staff/*', requireAuth)
app.use('/api/backup/*', requireAuth)
app.use('/api/photos/*', requireAuth)
app.use('/api/alerts', requireAuth)
app.use('/api/alerts/*', requireAuth)
app.use('/api/rooms/*', requireAuth)
app.use('/api/waitlist', requireAuth)
app.use('/api/waitlist/*', requireAuth)

app.route('/api/alerts', alertRoutes)
app.route('/api/rooms', roomRoutes)
app.route('/api/units', unitRoutes)
app.route('/api/bookings', bookingRoutes)
app.route('/api/cleaning', cleaningRoutes)
app.route('/api/analytics', analyticsRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/guests', guestRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/staff', staffRoutes)
app.route('/api/backup', backupRoutes)
app.route('/api/waitlist', waitlistRoutes)
app.route('/api/photos', photoRoutes)

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
/** Cron expression for the daily backup — see `[triggers]` in wrangler.toml. */
const BACKUP_CRON = '15 4 * * *'

/**
 * Writes a dated snapshot to the backup store and prunes older ones.
 * Runs on its own cron so a failing digest cannot take the backup down with it.
 */
async function runDailyBackup(env: Bindings): Promise<void> {
  const store = backupStore(env)
  if (!store) {
    console.warn('daily backup: no BACKUPS binding, skipping')
    return
  }

  const file = await exportAll(env.DB, env.APP_VERSION ?? 'unknown')
  const body = JSON.stringify(file)

  // KV caps a value at 25 MiB; warn well before that becomes a surprise.
  const megabytes = body.length / 1_048_576
  if (store.kind === 'kv' && megabytes > 20) {
    console.error(`daily backup: ${megabytes.toFixed(1)} MiB is near KV's 25 MiB limit — move to R2`)
  }

  const key = `${DAILY_PREFIX}${backupFilename()}`
  await store.put(key, body)

  const pruned = await pruneDaily(store)
  console.log(
    `daily backup: wrote ${key} (${Math.round(body.length / 1024)} KiB, ${store.kind})` +
      (pruned.length > 0 ? `, pruned ${pruned.length}` : '')
  )
}

async function scheduled(event: ScheduledController, env: Bindings): Promise<void> {
  if (event.cron === BACKUP_CRON) {
    try {
      await runDailyBackup(env)
    } catch (error) {
      console.error('daily backup failed', error)
    }
    return
  }

  try {
    const settings = await loadSettings(env.DB)
    const digest = await buildDigest(env.DB, settings)

    if (!digest) {
      console.log('scheduled: nothing to report')
      return
    }

    // Note the digest is built above this guard, not below it: the same query
    // feeds the dashboard's summary panel, so if delivery is ever switched off
    // again the cron keeps exercising that logic and a break in it still shows
    // up here rather than only when someone opens the page.
    if (!EXTERNAL_DELIVERY_ENABLED) {
      // Deliberately console.log, not warn. Nothing has gone wrong — delivery
      // would be off by decision, and a twice-daily warning about absent Green
      // API credentials is noise that trains people to ignore the log.
      console.log(
        `scheduled: digest ready (${digest.sections.length} sections); ` +
          'external delivery is off, nothing sent'
      )
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