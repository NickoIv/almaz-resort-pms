#!/usr/bin/env node
/**
 * Prints a PIN hash in the format staff_users.pin_code_hash expects.
 *
 * For disaster recovery only — normally PINs are set from the Персонал page.
 * Use it to restore admin access when the staff table itself was lost:
 *
 *   node scripts/hash-pin.mjs 4821
 *   npx wrangler d1 execute DB --remote --command \
 *     "UPDATE staff_users SET pin_code_hash = '<hash>', is_active = 1 WHERE phone = '+7...'"
 *
 * Must stay in step with src/lib/pin.ts.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const ITERATIONS = 100_000
const KEY_BYTES = 32

const pin = process.argv[2]
if (!pin || !/^\d{4,8}$/.test(pin)) {
  console.error('usage: node scripts/hash-pin.mjs <4-8 digit PIN>')
  process.exit(1)
}

const salt = randomBytes(16)
const hash = pbkdf2Sync(pin, salt, ITERATIONS, KEY_BYTES, 'sha256')

console.log(`pbkdf2$sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`)
