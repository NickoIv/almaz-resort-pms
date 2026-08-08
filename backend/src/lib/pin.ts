/**
 * PIN hashing for staff accounts.
 *
 * Stored format: `pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>`
 * PBKDF2-SHA256 is used because it is available in the Workers runtime via
 * WebCrypto and needs no native dependency.
 */

const ITERATIONS = 100_000
const KEY_LENGTH_BITS = 256

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_LENGTH_BITS
  )
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await derive(pin, salt, ITERATIONS)
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64(salt.buffer)}$${toBase64(bits)}`
}

/** Constant-time comparison so a wrong PIN cannot be found byte by byte. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 5) return false
  const [scheme, hash, iterationsRaw, saltB64, expectedB64] = parts
  if (scheme !== 'pbkdf2' || hash !== 'sha256') return false

  const iterations = Number(iterationsRaw)
  if (!Number.isInteger(iterations) || iterations <= 0) return false

  try {
    const bits = await derive(pin, fromBase64(saltB64), iterations)
    return timingSafeEqual(new Uint8Array(bits), fromBase64(expectedB64))
  } catch {
    return false
  }
}