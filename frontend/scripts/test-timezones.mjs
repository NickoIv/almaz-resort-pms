/**
 * Runs the test suite under several device timezones.
 *
 * The hotel is on Almaty time and staff use the app while travelling, so
 * "today" must never follow the viewer's device. Overriding the timezone by
 * hand in DevTools checks one zone once; this checks the whole suite against
 * zones on both sides of Almaty, including the extremes, on every run.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ZONES = [
  'Asia/Almaty', //        UTC+5  — the hotel itself
  'Asia/Ho_Chi_Minh', //   UTC+7  — the reported travelling case
  'Asia/Jakarta', //       UTC+7
  'America/New_York', //   UTC-4  — behind Almaty, previous day for much of it
  'Pacific/Kiritimati', // UTC+14 — furthest ahead in the world
  'Pacific/Midway', //     UTC-11 — furthest behind
  'UTC',
]

// Run vitest's JS entry with the current Node binary. Going through a shell
// drops TZ from the child env on Windows — which would silently turn this into
// seven identical runs — and Node refuses to spawn the .cmd shim without one.
const vitestEntry = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))

/** Minutes west of UTC, as the child process sees it. */
function observedOffset(timeZone) {
  const probe = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(String(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()))"],
    { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' }
  )
  return probe.stdout?.trim()
}

// Guard: if TZ does not reach the child, every run below would be the machine's
// own zone and this script would pass while testing nothing.
const offsets = new Set(ZONES.map(observedOffset))
if (offsets.size < 2) {
  console.error(
    `TZ is not reaching the child process (every zone reported offset ${[...offsets][0]}).\n` +
      `Aborting rather than reporting a pass that proves nothing.`
  )
  process.exit(1)
}

let failed = 0

for (const timeZone of ZONES) {
  const result = spawnSync(process.execPath, [vitestEntry, 'run', ...process.argv.slice(2)], {
    env: { ...process.env, TZ: timeZone },
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    console.error(`Could not run vitest for ${timeZone}:`, result.error.message)
    failed++
    continue
  }

  const ok = result.status === 0
  if (!ok) failed++
  const utcOffset = -Number(observedOffset(timeZone)) / 60
  const label = `UTC${utcOffset >= 0 ? '+' : ''}${utcOffset}`
  console.log(`\n=== ${timeZone} (${label}): ${ok ? 'PASS' : 'FAIL'} ===\n`)
}

console.log(
  failed === 0
    ? `All ${ZONES.length} timezones passed.`
    : `${failed} of ${ZONES.length} timezones failed.`
)
process.exit(failed === 0 ? 0 : 1)
