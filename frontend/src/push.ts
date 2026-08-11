import { api } from './api'

/**
 * Web Push, from the browser's side.
 *
 * Three things have to line up before a phone can ring, and they fail
 * independently, so each is reported separately rather than collapsed into one
 * "notifications don't work":
 *
 *   1. the browser supports the Push API at all;
 *   2. on iOS, the app is running from the home screen — Safari refuses to
 *      subscribe from an ordinary tab, and does so silently;
 *   3. the user has granted permission.
 *
 * A person who is told "add the app to your home screen first" can fix their
 * own problem. A person told "unsupported" gives up.
 */

export type PushSupport =
  | { kind: 'ready' }
  | { kind: 'needs-install' }
  | { kind: 'unsupported'; reason: string }

/** Running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS predates the standard media query and still sets this instead.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  // iPadOS reports itself as a Mac; the touch points give it away.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator)) {
    return { kind: 'unsupported', reason: 'Браузер не поддерживает Service Worker' }
  }
  if (!('PushManager' in window)) {
    // This is what an iPhone in a Safari tab looks like: the API is simply
    // absent until the app is installed to the home screen.
    return isIos() && !isStandalone()
      ? { kind: 'needs-install' }
      : { kind: 'unsupported', reason: 'Браузер не поддерживает push-уведомления' }
  }
  if (!('Notification' in window)) {
    return { kind: 'unsupported', reason: 'Браузер не поддерживает уведомления' }
  }
  if (isIos() && !isStandalone()) return { kind: 'needs-install' }
  return { kind: 'ready' }
}

export function permissionState(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied'
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToB64url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // `ready` resolves only once a worker is active, which is what
  // pushManager needs; registering and subscribing in the same tick fails.
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  return navigator.serviceWorker.ready
}

/** The subscription this browser already holds, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport().kind !== 'ready') return null
  try {
    const registered = await navigator.serviceWorker.getRegistration('/')
    return (await registered?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

/**
 * Asks permission, subscribes, and registers the result with the server.
 *
 * Throws with a message meant to be shown as-is: every failure here is
 * something the person in front of the screen has to act on.
 */
export async function enablePush(): Promise<void> {
  const support = pushSupport()
  if (support.kind === 'needs-install') {
    throw new Error('Сначала добавьте приложение на домашний экран')
  }
  if (support.kind === 'unsupported') throw new Error(support.reason)

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Уведомления запрещены в настройках браузера для этого сайта'
        : 'Разрешение не выдано'
    )
  }

  const { configured, public_key } = await api<{ configured: boolean; public_key: string | null }>(
    '/push/key'
  )
  if (!configured || !public_key) {
    throw new Error('Push-уведомления ещё не настроены на сервере')
  }

  const worker = await registration()
  const subscription = await worker.pushManager.subscribe({
    // Required to be true by every browser: a push that shows nothing to the
    // user is not allowed, which suits us — every push here is a visible alert.
    userVisibleOnly: true,
    applicationServerKey: b64urlToBytes(public_key) as BufferSource,
  })

  const json = subscription.toJSON()
  await api('/push/subscribe', {
    method: 'POST',
    body: {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: json.keys?.p256dh ?? bytesToB64url(subscription.getKey('p256dh')),
        auth: json.keys?.auth ?? bytesToB64url(subscription.getKey('auth')),
      },
    },
  })
}

/**
 * Unsubscribes this browser and tells the server to forget it.
 *
 * The server is told first. If the browser drops the subscription and the
 * request then fails, the row would be left pointing at an endpoint nobody owns
 * — harmless but permanent, since only the browser could have named it.
 */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return

  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } })
  await subscription.unsubscribe().catch(() => {})
}

export async function sendTestPush(): Promise<void> {
  await api('/push/test', { method: 'POST' })
}

/**
 * Shows a notification from this browser, with no network involved.
 *
 * This exists because "уведомления не приходят" is three different faults and
 * the app could not tell them apart. A push has to survive: the server
 * encrypting it, the push service accepting and delivering it, the browser
 * decrypting it, and finally the operating system agreeing to draw it. When one
 * of those fails, every one of them looks the same from here — and the server
 * reporting "отправлено" is about the second link, not the last.
 *
 * A local notification skips the first three links entirely. If it appears, the
 * browser and the OS are willing and the fault is in delivery. If it does not,
 * nothing sent from anywhere would have appeared either, and the place to look
 * is the system's own notification settings.
 *
 * The return value is what the *browser* thinks: `getNotifications` lists what
 * it has accepted. An operating system that silently swallows the display still
 * leaves the entry here — which is itself the useful answer, because it means
 * the app has done everything it can.
 */
export async function showLocalNotification(): Promise<{ accepted: boolean }> {
  const support = pushSupport()
  if (support.kind === 'needs-install') {
    throw new Error('Сначала добавьте приложение на домашний экран')
  }
  if (support.kind === 'unsupported') throw new Error(support.reason)
  if (permissionState() !== 'granted') {
    throw new Error('Сначала разрешите уведомления на этом устройстве')
  }

  const registered = await navigator.serviceWorker.getRegistration('/')
  if (!registered) throw new Error('Service worker не зарегистрирован — включите уведомления заново')

  await registered.showNotification('Taura PMS — проверка', {
    body: 'Это показал сам браузер, без сервера.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'local-test',
    data: { url: '/notifications' },
  })

  const shown = await registered.getNotifications({ tag: 'local-test' })
  return { accepted: shown.length > 0 }
}
