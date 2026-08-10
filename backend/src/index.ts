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
import pushRoutes from './routes/push'
import staffRoutes from './routes/staff'
import waitlistRoutes from './routes/waitlist'
import { pruneLoginAttempts } from './lib/login-guard'
import { pruneDeliveries, sweepAndPush } from './lib/push'
import { vapidKeysOf } from './lib/webpush'
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
app.use('/api/push/*', requireAuth)

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
app.route('/api/push', pushRoutes)

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error('Unhandled error', err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

/**
 * Everything scheduled runs off **one** cron trigger.
 *
 * Not a stylistic choice: the Workers free plan allows five cron triggers per
 * *account*, and this account runs several Workers. Four separate schedules
 * here — two digests, a backup and the push sweep — pushed it over, and the
 * deploy failed with code 10072 after the Worker itself had already uploaded.
 *
 * So the trigger fires every five minutes and the handler decides what is due.
 * The times below are the same ones the four triggers used, and each job keeps
 * its own try/catch, so a failing digest still cannot take the backup down with
 * it. The cost is that a job whose slot is skipped is skipped for the day —
 * acceptable for a digest, and the backup writes a date-keyed object, so a
 * later run of the same day would simply overwrite it.
 */

/**
 * Which scheduled jobs are due now. UTC throughout; Almaty is UTC+5, so 04:00
 * UTC is the 09:00 morning digest and 13:00 UTC the 18:00 evening one.
 *
 * The windows are five minutes wide because that is the trigger interval: a
 * narrower test would simply never match.
 */
function jobsDue(now: Date): { digest: boolean; backup: boolean; prune: boolean } {
  const hour = now.getUTCHours()
  const minute = now.getUTCMinutes()

  return {
    // 09:00 and 18:00 Almaty.
    digest: (hour === 4 || hour === 13) && minute < 5,
    // 09:15 Almaty, just after the morning digest.
    backup: hour === 4 && minute >= 15 && minute < 20,
    // Once a day, in the quiet hours.
    prune: hour === 3 && minute < 5,
  }
}

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

/**
 * Pushes whatever each subscriber has not been told about yet.
 *
 * Runs on its own five-minute cron rather than inside the twice-daily digest,
 * because the thing being fixed is precisely that a cleaning breach at 11:00
 * should not wait until 18:00 to reach the housekeeper's phone. The work is
 * proportional to the number of people who switched notifications on, not to
 * the size of the staff list — a hotel where nobody subscribed does two queries
 * and stops.
 */
async function runPushSweep(env: Bindings): Promise<void> {
  const keys = vapidKeysOf(env)
  if (!keys) {
    // Not a warning. Push is unconfigured until the operator generates a VAPID
    // pair, and shouting about it every five minutes would bury real errors.
    return
  }

  const results = await sweepAndPush(env.DB, keys)
  const sent = results.reduce((total, row) => total + row.sent, 0)
  const removed = results.reduce((total, row) => total + row.removed, 0)

  if (sent > 0 || removed > 0) {
    console.log(
      `push sweep: ${sent} sent to ${results.length} staff` +
        (removed > 0 ? `, ${removed} dead subscriptions removed` : '')
    )
  }
}

/** The twice-daily digest. Separate so the single handler stays readable. */
async function runDigest(env: Bindings): Promise<void> {
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

/**
 * The single scheduled entry point.
 *
 * Each job is awaited inside its own error boundary, so one failing does not
 * cancel the rest — that isolation used to come free from having separate
 * triggers, and has to be written out now that they share one.
 */
async function scheduled(_event: ScheduledController, env: Bindings): Promise<void> {
  const due = jobsDue(new Date())

  // Every run. This is the one that has to be timely; the rest are daily.
  try {
    await runPushSweep(env)
  } catch (error) {
    console.error('push sweep failed', error)
  }

  if (due.digest) await runDigest(env)

  if (due.backup) {
    try {
      await runDailyBackup(env)
    } catch (error) {
      console.error('daily backup failed', error)
    }
  }

  if (due.prune) {
    try {
      await pruneDeliveries(env.DB)
      // Invented phone numbers each leave a row behind; this is what stops a
      // flood of them growing the table for as long as someone keeps sending.
      await pruneLoginAttempts(env.DB)
    } catch (error) {
      console.error('nightly prune failed', error)
    }
  }
}

export default {
  fetch: app.fetch,
  scheduled,
}