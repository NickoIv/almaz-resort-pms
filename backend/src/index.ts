import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from './lib/auth'
import analyticsRoutes from './routes/analytics'
import authRoutes from './routes/auth'
import unitRoutes from './routes/units'
import bookingRoutes from './routes/bookings'
import cleaningRoutes from './routes/cleaning'
import type { AppEnv } from './types'

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

app.route('/api/units', unitRoutes)
app.route('/api/bookings', bookingRoutes)
app.route('/api/cleaning', cleaningRoutes)
app.route('/api/analytics', analyticsRoutes)

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error('Unhandled error', err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app