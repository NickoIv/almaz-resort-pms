/**
 * Where the sun is over Alma-Arasan, roughly.
 *
 * The hotel sits at 43.14°N, 76.91°E in the gorge above Almaty. This is the
 * standard low-precision solar position — good to a minute or two, which is
 * far more than a 34-pixel dial can show. It deliberately does not account for
 * the ridge to the south, which in reality takes the sun early.
 *
 * Everything is computed from Almaty wall-clock time, like the rest of the app,
 * so the dial reads the same on a laptop in another timezone.
 */

export const TAURA_LAT = 43.14
export const TAURA_LON = 76.91

/** Kazakhstan has run a single UTC+5 offset with no DST since 2024. */
const UTC_OFFSET_HOURS = 5

const RAD = Math.PI / 180

/** Days since the start of the year, from a UTC-fields Date. */
function dayOfYear(almaty: Date): number {
  const start = Date.UTC(almaty.getUTCFullYear(), 0, 0)
  return Math.floor((almaty.getTime() - start) / 86_400_000)
}

export type SunDay = {
  /** Hours after Almaty midnight, e.g. 5.72 for 05:43. */
  sunrise: number
  sunset: number
  /** Current time in the same units. */
  now: number
  /** 0 at sunrise, 1 at sunset; null while it is dark. */
  progress: number | null
  isDay: boolean
}

/**
 * Sunrise and sunset for the date shown, plus how far through the day the sun
 * currently is.
 *
 * `now` is a real Date; the shift into Almaty wall-clock happens here, so
 * callers never have to think about it.
 */
export function sunPosition(now: Date = new Date()): SunDay {
  // A Date whose UTC fields hold Almaty wall-clock, as elsewhere in the app.
  const almaty = new Date(now.getTime() + UTC_OFFSET_HOURS * 3_600_000)
  const hours = almaty.getUTCHours() + almaty.getUTCMinutes() / 60 + almaty.getUTCSeconds() / 3600

  const n = dayOfYear(almaty)

  // Solar declination — the tilt that makes winter days short.
  const declination =
    23.45 * RAD * Math.sin(2 * Math.PI * ((284 + n) / 365))

  const latRad = TAURA_LAT * RAD

  // Sunrise is defined as the centre of the disc sitting 0.833° below the
  // horizon — half its own width, plus the atmosphere bending the light over
  // the edge. Without this the times come out several minutes short of every
  // published table, which is the first thing anyone would check them against.
  const horizon = -0.833 * RAD
  const cosHourAngle =
    (Math.sin(horizon) - Math.sin(latRad) * Math.sin(declination)) /
    (Math.cos(latRad) * Math.cos(declination))

  // Inside the polar circles this goes out of range; Almaty never does, but a
  // clamp costs nothing and keeps acos from returning NaN.
  const clamped = Math.min(1, Math.max(-1, cosHourAngle))
  const hourAngle = Math.acos(clamped) / RAD

  // Solar noon, corrected for the difference between the timezone meridian
  // (75°E for UTC+5) and the hotel's own longitude, plus the equation of time.
  const b = (2 * Math.PI * (n - 81)) / 364
  const equationOfTime =
    9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)
  const solarNoon = 12 - (TAURA_LON - 15 * UTC_OFFSET_HOURS) / 15 - equationOfTime / 60

  const sunrise = solarNoon - hourAngle / 15
  const sunset = solarNoon + hourAngle / 15

  const isDay = hours >= sunrise && hours <= sunset
  const progress = isDay ? (hours - sunrise) / (sunset - sunrise) : null

  return { sunrise, sunset, now: hours, progress, isDay }
}

/** 5.72 -> "05:43" */
export function hoursToClock(value: number): string {
  const total = Math.round(value * 60)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
