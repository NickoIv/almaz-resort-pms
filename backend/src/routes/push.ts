import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { writeAudit } from '../lib/audit'
import { readJson } from '../lib/body'
import { pushToStaff, subscriptionsOf } from '../lib/push'
import { vapidKeysOf } from '../lib/webpush'
import type { AppEnv } from '../types'

const push = new Hono<AppEnv>()

/**
 * Per-device push subscriptions.
 *
 * Open to every role, unlike Настройки: this is not an administrative setting
 * but a personal one, and a housekeeper has to be able to switch her own phone
 * on without an admin present. Nothing here reads or writes anyone else's rows
 * — the staff id always comes from the token, never from the request body.
 */

type SubscribeBody = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * Rough shape check. The push service is the real validator; this is hygiene.
 *
 * Endpoints must be https, because the payload is encrypted but the request
 * still reveals *that* a notification went to a given device. Loopback is the
 * exception, matching the rule browsers use for secure contexts, and it is what
 * lets a stand-in push service on 127.0.0.1 exercise the real send path.
 */
function looksLikeSubscription(body: Partial<SubscribeBody>): body is SubscribeBody {
  if (
    typeof body.endpoint !== 'string' ||
    body.endpoint.length > 1000 ||
    typeof body.keys?.p256dh !== 'string' ||
    typeof body.keys?.auth !== 'string'
  ) {
    return false
  }

  try {
    const url = new URL(body.endpoint)
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback)
  } catch {
    return false
  }
}

/**
 * GET /api/push/key — the VAPID public key the browser needs to subscribe.
 *
 * Public keys are public by definition; this endpoint exists so the key lives
 * in one place (a Worker secret) rather than being baked into the frontend
 * build, where rotating it would mean a redeploy of both halves.
 */
push.get('/key', (c) => {
  const keys = vapidKeysOf(c.env)
  return c.json({ configured: keys !== null, public_key: keys?.publicKey ?? null })
})

/** GET /api/push/devices — this person's registered devices. */
push.get('/devices', async (c) => {
  const staff = c.get('staff')
  const devices = await c.env.DB.prepare(
    `SELECT id, endpoint, user_agent, created_at, last_ok_at
       FROM push_subscriptions
      WHERE staff_user_id = ?
      ORDER BY created_at`
  )
    .bind(staff.sub)
    .all()

  return c.json({ devices: devices.results })
})

/**
 * POST /api/push/subscribe — register this browser for the signed-in person.
 *
 * Upserts on the endpoint rather than inserting. An endpoint identifies one
 * browser install, so if a second member of staff signs in on the shared
 * reception machine and switches notifications on, the row has to move to them
 * — otherwise that device would keep buzzing for whoever registered it first.
 */
push.post('/subscribe', async (c) => {
  const staff = c.get('staff')
  const body = await readJson<SubscribeBody>(c)

  if (!looksLikeSubscription(body)) {
    throw new HTTPException(400, { message: 'Некорректные данные подписки' })
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (staff_user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       staff_user_id = excluded.staff_user_id,
       p256dh        = excluded.p256dh,
       auth          = excluded.auth,
       user_agent    = excluded.user_agent,
       failures      = 0`
  )
    .bind(
      staff.sub,
      body.endpoint,
      body.keys.p256dh,
      body.keys.auth,
      (c.req.header('user-agent') ?? '').slice(0, 300)
    )
    .run()

  await writeAudit(c.env.DB, staff.sub, 'push.subscribe', 'push_subscriptions', null)

  return c.json({ subscribed: true })
})

/** POST /api/push/unsubscribe — forget this browser. */
push.post('/unsubscribe', async (c) => {
  const staff = c.get('staff')
  const body = await readJson<{ endpoint: string }>(c)

  if (typeof body.endpoint !== 'string') {
    throw new HTTPException(400, { message: 'Не указан endpoint подписки' })
  }

  // Scoped to the caller: an endpoint is guessable in principle, and nobody
  // should be able to switch off someone else's notifications.
  const result = await c.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND staff_user_id = ?'
  )
    .bind(body.endpoint, staff.sub)
    .run()

  await writeAudit(c.env.DB, staff.sub, 'push.unsubscribe', 'push_subscriptions', null)

  return c.json({ removed: result.meta.changes ?? 0 })
})

/**
 * POST /api/push/test — send this person a notification right now.
 *
 * The only way to find out whether a phone will actually ring is to make it
 * ring. Permission can be granted and the device still stay silent: a battery
 * saver, a locked-down browser, an iPhone that was never added to the home
 * screen. None of that is visible from the server.
 */
push.post('/test', async (c) => {
  const staff = c.get('staff')
  const keys = vapidKeysOf(c.env)

  if (!keys) {
    throw new HTTPException(503, {
      message:
        'Push-уведомления не настроены на сервере: задайте секреты VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY',
    })
  }

  const devices = await subscriptionsOf(c.env.DB, staff.sub)
  if (devices.length === 0) {
    throw new HTTPException(400, {
      message: 'На этом аккаунте нет ни одного устройства — сначала разрешите уведомления',
    })
  }

  const result = await pushToStaff(c.env.DB, keys, staff.sub, {
    title: 'Taura PMS',
    body: 'Проверка уведомлений — всё работает.',
    url: '/',
    tag: 'test',
  })

  await writeAudit(c.env.DB, staff.sub, 'push.test', 'push_subscriptions', null)

  if (result.sent === 0) {
    throw new HTTPException(502, {
      message:
        result.removed > 0
          ? 'Подписка устарела — разрешите уведомления заново на этом устройстве'
          : 'Push-сервис не принял уведомление',
    })
  }

  return c.json(result)
})

export default push
