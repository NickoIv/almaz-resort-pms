/*
 * Service worker — push notifications only.
 *
 * It deliberately caches nothing. A service worker's usual job is to serve an
 * app offline, and for a PMS that is actively harmful: a housekeeper looking at
 * a cached room list has no way to tell it is stale, and stale is exactly what
 * makes someone clean a room that was already done. The alert bell and the
 * board are worth nothing if they are not live. So this file exists for one
 * reason — the Push API requires a service worker to deliver into.
 *
 * Kept as plain JavaScript in public/ rather than bundled: it must be served
 * from the site root with its own URL for the scope to cover the whole app, and
 * its content hash must stay stable so the browser does not treat every deploy
 * as a new worker.
 */

// A newly deployed worker should take over at once. There is no cached content
// for the old one to be serving, so there is nothing to lose by not waiting.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // A malformed payload should still surface something rather than nothing:
    // silence would look identical to push being broken.
  }

  const title = data.title || 'Taura PMS'

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // The stable alert id: a repeat of the same situation replaces the
      // existing bubble instead of stacking a second one under it.
      tag: data.tag || 'taura',
      // Staff are on a shift, not browsing. Requiring a tap to dismiss means a
      // notification that arrives while the phone is in a pocket is still there
      // when it comes out.
      requireInteraction: true,
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        // Reuse a tab that is already open rather than piling up windows: on a
        // phone the app is usually already running behind the lock screen.
        for (const client of windows) {
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(target).catch(() => {})
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      })
  )
})
