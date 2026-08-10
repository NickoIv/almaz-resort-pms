import { computeAlerts, roleHasAlerts, type Alert } from './alerts'
import {
  PushSubscriptionGone,
  sendPush,
  type PushPayload,
  type PushSubscription,
  type VapidKeys,
} from './webpush'
import type { Role } from '../types'

/**
 * Turning alerts into notifications on people's phones.
 *
 * The rule this file exists to enforce: **push never invents anything.** It
 * sends exactly what `computeAlerts` already decided this person should see, so
 * a notification and the screen it opens can never disagree. Everything here is
 * about *when* and *how often*, not *what*.
 */

/**
 * More than this in one sweep and the person gets a single summary instead.
 *
 * Coming on shift to fourteen overdue rooms is one situation, not fourteen
 * events. A phone that buzzes fourteen times gets silenced, and then the
 * channel is worth nothing for the one alert that mattered.
 */
const MAX_INDIVIDUAL = 3

/** Delivery rows older than this are dropped; the alert ids are long gone. */
const DELIVERY_RETENTION_DAYS = 30

type SubscriptionRow = {
  id: number
  endpoint: string
  p256dh: string
  auth: string
}

type AudienceRow = {
  id: number
  role: Role
}

export type PushResult = {
  staff_user_id: number
  sent: number
  failed: number
  removed: number
}

function payloadFor(alert: Alert): PushPayload {
  return {
    title: alert.title,
    body: alert.detail,
    url: alert.href,
    // The stable alert id doubles as the notification tag, so a repeat of the
    // same situation replaces the old bubble instead of stacking under it.
    tag: alert.id,
  }
}

/** Every live subscription belonging to one member of staff. */
export async function subscriptionsOf(
  db: D1Database,
  staffUserId: number
): Promise<SubscriptionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, endpoint, p256dh, auth
         FROM push_subscriptions
        WHERE staff_user_id = ?
        ORDER BY created_at`
    )
    .bind(staffUserId)
    .all<SubscriptionRow>()
  return results
}

/**
 * Sends one notification to every device a person has registered.
 *
 * A subscription the push service reports as gone is deleted on the spot: it
 * means the app was uninstalled or permission revoked, and keeping the row
 * would mean a failed request twelve times an hour forever. Any other failure
 * is counted, so a persistently broken endpoint can be recognised later without
 * losing the row to a passing outage.
 */
export async function pushToStaff(
  db: D1Database,
  keys: VapidKeys,
  staffUserId: number,
  payload: PushPayload
): Promise<{ sent: number; failed: number; removed: number }> {
  const devices = await subscriptionsOf(db, staffUserId)
  let sent = 0
  let failed = 0
  let removed = 0

  for (const device of devices) {
    const subscription: PushSubscription = {
      endpoint: device.endpoint,
      p256dh: device.p256dh,
      auth: device.auth,
    }

    try {
      await sendPush(subscription, payload, keys)
      sent++
      await db
        .prepare(
          `UPDATE push_subscriptions
              SET last_ok_at = datetime('now', '+5 hours'), failures = 0
            WHERE id = ?`
        )
        .bind(device.id)
        .run()
    } catch (error) {
      if (error instanceof PushSubscriptionGone) {
        removed++
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(device.id).run()
      } else {
        failed++
        await db
          .prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?')
          .bind(device.id)
          .run()
      }
    }
  }

  return { sent, failed, removed }
}

/**
 * Claims an alert for one person, returning true if it was not already sent.
 *
 * The claim is written *before* the send, not after. Getting this backwards
 * means a push service timing out turns into the same notification going out
 * again on the next sweep, and again, and again — the failure mode that trains
 * people to turn notifications off. The cost of this order is that a genuinely
 * failed send is not retried, which is acceptable precisely because push is not
 * the system of record: the alert is still sitting on the person's screen.
 */
async function claim(db: D1Database, staffUserId: number, alertId: string): Promise<boolean> {
  const result = await db
    .prepare('INSERT OR IGNORE INTO push_deliveries (staff_user_id, alert_id) VALUES (?, ?)')
    .bind(staffUserId, alertId)
    .run()
  return result.meta.changes === 1
}

/**
 * One pass over everyone who has notifications switched on.
 *
 * Only staff with at least one registered device are considered, so the cost is
 * proportional to people who actually asked for this rather than to the size of
 * the staff list.
 */
export async function sweepAndPush(db: D1Database, keys: VapidKeys): Promise<PushResult[]> {
  const { results: audience } = await db
    .prepare(
      `SELECT DISTINCT s.id, s.role
         FROM push_subscriptions p
         JOIN staff_users s ON s.id = p.staff_user_id
        WHERE s.is_active = 1`
    )
    .all<AudienceRow>()

  const out: PushResult[] = []

  for (const person of audience) {
    if (!roleHasAlerts(person.role)) continue

    const alerts = await computeAlerts(db, { id: person.id, role: person.role })

    const fresh: Alert[] = []
    for (const alert of alerts) {
      if (await claim(db, person.id, alert.id)) fresh.push(alert)
    }
    if (fresh.length === 0) continue

    const totals = { sent: 0, failed: 0, removed: 0 }
    const messages =
      fresh.length <= MAX_INDIVIDUAL
        ? fresh.map(payloadFor)
        : [
            {
              title: `Taura PMS — ${fresh.length} новых событий`,
              body: fresh
                .slice(0, MAX_INDIVIDUAL)
                .map((alert) => alert.title)
                .join('; '),
              // A summary spans several places, so it opens the one screen that
              // lists all of them rather than guessing at one.
              url: '/',
              tag: 'digest',
            },
          ]

    for (const message of messages) {
      const result = await pushToStaff(db, keys, person.id, message)
      totals.sent += result.sent
      totals.failed += result.failed
      totals.removed += result.removed
    }

    out.push({ staff_user_id: person.id, ...totals })
  }

  return out
}

/** Drops delivery rows old enough that their alerts cannot recur. */
export async function pruneDeliveries(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM push_deliveries
        WHERE datetime(sent_at) < datetime('now', '+5 hours', '-${DELIVERY_RETENTION_DAYS} days')`
    )
    .run()
  return result.meta.changes ?? 0
}
