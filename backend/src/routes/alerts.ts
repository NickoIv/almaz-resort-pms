import { Hono } from 'hono'
import { BOOKING_WINDOW_HOURS, computeAlerts } from '../lib/alerts'
import { requireRole } from '../lib/auth'
import { CLEANING_SLA_MINUTES } from '../lib/cleaning'
import type { AppEnv } from '../types'

const alerts = new Hono<AppEnv>()

/**
 * The alert bell's feed.
 *
 * One endpoint rather than three polls: the client asks every 45 seconds, and
 * splitting that across three requests would triple the traffic to answer one
 * question. The computation itself is in lib/alerts, shared with the push
 * sweep — see the notes there on role scoping and on why the ids are stable.
 */

// Waiters have nothing in this set they can act on; see lib/alerts.
const canSeeAlerts = requireRole('admin', 'housekeeper')

alerts.get('/', canSeeAlerts, async (c) => {
  const staff = c.get('staff')

  return c.json({
    sla_minutes: CLEANING_SLA_MINUTES,
    booking_window_hours: BOOKING_WINDOW_HOURS,
    alerts: await computeAlerts(c.env.DB, { id: staff.sub, role: staff.role }),
  })
})

export default alerts
