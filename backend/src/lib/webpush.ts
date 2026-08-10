/**
 * Web Push, implemented directly on WebCrypto.
 *
 * Every notification channel this project tried had someone else's quota in the
 * middle of it — Green API caps a free instance at three chats, which cannot
 * cover a shift. Web Push has no such middle: the browser hands us a URL at
 * Google, Mozilla or Apple, and pushing to it costs nothing and is not rate-
 * limited per recipient. The price is that the protocol is ours to implement.
 *
 * Two specs are involved and it is worth keeping them apart:
 *
 *   RFC 8292 (VAPID) — proves *who is sending*. A signed JWT plus our public
 *     key in the Authorization header, so a push service can attribute traffic
 *     to this application and contact us about it.
 *   RFC 8291 (Message Encryption) — makes the *payload* unreadable to the push
 *     service. The browser generated a keypair we never see the private half
 *     of; we do ECDH against its public key so only that browser can decrypt.
 *
 * Nothing here depends on the Node build of `web-push`, which cannot run on
 * Workers: it reaches for `crypto.createECDH` and Node Buffers. Everything
 * below is WebCrypto, which the Workers runtime implements natively.
 */

/** Records are capped by the spec; ours are a few hundred bytes of JSON. */
const RECORD_SIZE = 4096

/** How long a push service should hold a notification for an offline device. */
const DEFAULT_TTL_SECONDS = 12 * 60 * 60

/** VAPID tokens must not outlive 24h; twelve keeps well clear of clock skew. */
const VAPID_TTL_SECONDS = 12 * 60 * 60

export type PushSubscription = {
  endpoint: string
  /** Browser's public key, base64url, uncompressed P-256 point (65 bytes). */
  p256dh: string
  /** Browser's auth secret, base64url (16 bytes). */
  auth: string
}

export type VapidKeys = {
  /** base64url, uncompressed P-256 point (65 bytes). */
  publicKey: string
  /** base64url, raw private scalar (32 bytes). */
  privateKey: string
  /** `mailto:` or `https:` URL a push service can use to reach the operator. */
  subject: string
}

/** A push service said this subscription is gone; the row should be deleted. */
export class PushSubscriptionGone extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Подписка больше не действительна (${status})`)
    this.name = 'PushSubscriptionGone'
    this.status = status
  }
}

// ── base64url ──────────────────────────────────────────────────────────────
// The push ecosystem is base64url everywhere: keys from the browser, the JWT,
// the header. Padding is stripped on the way out and restored on the way in,
// because browsers send unpadded and atob insists on padded.

export function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function bytesToB64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const utf8 = (value: string) => new TextEncoder().encode(value)

// ── keys ───────────────────────────────────────────────────────────────────

/**
 * Rebuilds a WebCrypto key from the raw scalar we keep in a secret.
 *
 * The conventional storage format for VAPID is a raw 32-byte private scalar
 * and a raw 65-byte public point, which is what every generator emits and what
 * `wrangler secret put` can hold as one line. WebCrypto will not import that
 * pair directly, so it is assembled into a JWK: `d` is the scalar, and `x`/`y`
 * are the two halves of the public point after its leading 0x04 marker.
 */
async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const publicBytes = b64urlToBytes(keys.publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY должен быть несжатой точкой P-256 (65 байт)')
  }

  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: bytesToB64url(publicBytes.subarray(1, 33)),
      y: bytesToB64url(publicBytes.subarray(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

/**
 * Generates a VAPID keypair.
 *
 * Kept here rather than in a throwaway script so the format the app reads and
 * the format the operator is told to store can never drift apart.
 */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  // `generateKey` is typed as returning a key *or* a pair, since the result
  // depends on the algorithm; for ECDSA it is always a pair.
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair

  const publicRaw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer
  )
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  if (!jwk.d) throw new Error('WebCrypto не выдал приватную часть ключа')
  return { publicKey: bytesToB64url(publicRaw), privateKey: jwk.d }
}

// ── RFC 8292: the VAPID Authorization header ───────────────────────────────

async function vapidHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const { origin } = new URL(endpoint)

  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + VAPID_TTL_SECONDS,
    sub: keys.subject,
  }

  const signingInput = `${bytesToB64url(utf8(JSON.stringify(header)))}.${bytesToB64url(
    utf8(JSON.stringify(payload))
  )}`

  // WebCrypto's ECDSA output is already the raw r‖s pair JWS wants — no DER
  // unwrapping, which is the step Node implementations have to do by hand.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importVapidPrivateKey(keys),
      utf8(signingInput)
    )
  )

  return `vapid t=${signingInput}.${bytesToB64url(signature)}, k=${keys.publicKey}`
}

// ── RFC 8291: payload encryption (aes128gcm) ───────────────────────────────

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    bytes * 8
  )
  return new Uint8Array(bits)
}

/**
 * The encryption itself, with every random input supplied by the caller.
 *
 * Split out from `encryptPayload` so it is a pure function of its arguments,
 * which is what makes it testable: RFC 8291 §5 publishes a worked example with
 * fixed keys and a fixed salt, and `smoke-push.mjs` drives this function with
 * those values and compares the bytes. Crypto that is only ever exercised with
 * fresh randomness cannot be checked against anything — it either matches what
 * a real phone expects or it does not, and the first time you find out is when
 * a notification silently fails to arrive.
 *
 * The shape of the result is fixed by RFC 8188 §2.1: a header carrying the
 * salt, the record size and the sender's ephemeral public key, followed by the
 * AES-GCM ciphertext. The browser's service worker gets the plaintext back; the
 * push service in between sees only opaque bytes, which is the entire point —
 * a guest's name and a room number travel through Google's infrastructure.
 */
export async function encryptRecord(params: {
  uaPublic: Uint8Array
  authSecret: Uint8Array
  asPublic: Uint8Array
  asPrivate: CryptoKey
  salt: Uint8Array
  plaintext: string
}): Promise<Uint8Array> {
  const { uaPublic, authSecret, asPublic, asPrivate, salt, plaintext } = params

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  // WebCrypto names this field `public`; the Workers type definitions are
  // generated from an IDL that escapes it to `$public`. The runtime follows the
  // spec, so the literal is written correctly and cast past the typings.
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm

  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, asPrivate, 256))

  // Both public keys go into the info string, so a shared secret is bound to
  // the exact pair of parties that produced it.
  const prk = await hkdf(
    authSecret,
    sharedSecret,
    concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic),
    32
  )

  const cek = await hkdf(salt, prk, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, prk, utf8('Content-Encoding: nonce\0'), 12)

  // 0x02 marks the last record. Ours is always the only record: the payloads
  // here are a title and one line of detail, nowhere near the 4096-byte cap.
  const record = concat(utf8(plaintext), new Uint8Array([0x02]))
  if (record.length + 16 > RECORD_SIZE) {
    throw new Error('Слишком длинное уведомление для одного push-сообщения')
  }

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']),
      record
    )
  )

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE, false)

  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext)
}

/** Encrypts one push message for one subscription, with fresh randomness. */
export async function encryptPayload(
  subscription: PushSubscription,
  plaintext: string
): Promise<Uint8Array> {
  // Ephemeral, per message: reusing a keypair across sends would let a push
  // service link one message to another.
  const ephemeral = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )) as CryptoKeyPair

  return encryptRecord({
    uaPublic: b64urlToBytes(subscription.p256dh),
    authSecret: b64urlToBytes(subscription.auth),
    asPublic: new Uint8Array(
      (await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer
    ),
    asPrivate: ephemeral.privateKey,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    plaintext,
  })
}

// ── sending ────────────────────────────────────────────────────────────────

export type PushPayload = {
  title: string
  body: string
  /** In-app path the notification opens, e.g. `/cleaning`. */
  url: string
  /** Stable alert id, reused as the notification tag so a repeat replaces. */
  tag: string
}

/**
 * Delivers one notification to one device.
 *
 * A 404 or 410 means the browser threw the subscription away — the app was
 * uninstalled, or the user revoked permission. That is not a failure to retry;
 * it is an instruction to forget the row, so it is raised as its own error for
 * the caller to act on.
 */
export async function sendPush(
  subscription: PushSubscription,
  payload: PushPayload,
  keys: VapidKeys,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> {
  const body = await encryptPayload(subscription, JSON.stringify(payload))

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'normal',
    },
    body,
  })

  if (response.status === 404 || response.status === 410) {
    throw new PushSubscriptionGone(response.status)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Push-сервис вернул ${response.status}: ${detail.slice(0, 200)}`)
  }
}

/** Whether the Worker has everything it needs to send. */
export function vapidKeysOf(env: {
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    // Push services want a way to reach whoever is sending. A working address
    // matters if Google ever needs to ask why this origin is pushing.
    subject: env.VAPID_SUBJECT ?? 'mailto:admin@taura.kz',
  }
}
