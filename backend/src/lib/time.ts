/**
 * Time handling.
 *
 * D1's `now` is UTC, but the hotel books in Almaty local time (UTC+5, no DST
 * since Kazakhstan unified its zones in 2024). Bookings are stored as local
 * wall-clock strings, so every comparison against "now" has to shift UTC first.
 */

export const ALMATY_OFFSET = '+5 hours'

/** Local wall-clock date, e.g. `2026-08-08`. */
export const SQL_TODAY = `date('now', '${ALMATY_OFFSET}')`

/** Local wall-clock timestamp, e.g. `2026-08-08 17:30:00`. */
export const SQL_NOW = `datetime('now', '${ALMATY_OFFSET}')`

/**
 * Whether a booking covers "now".
 *
 * Rooms are sold by night, so a stay from the 8th to the 11th covers the whole
 * of the 9th. Recreation units are sold by the hour, so a gazebo booked
 * 14:00-18:00 is only busy during those hours.
 */
export const SQL_COVERS_NOW = `
  CASE WHEN u.type = 'room'
    THEN date(date_from) <= ${SQL_TODAY} AND date(date_to) >= ${SQL_TODAY}
    ELSE datetime(date_from) <= ${SQL_NOW} AND datetime(date_to) >= ${SQL_NOW}
  END`

/** Whether a booking starts after "now". */
export const SQL_STARTS_LATER = `
  CASE WHEN u.type = 'room'
    THEN date(date_from) > ${SQL_TODAY}
    ELSE datetime(date_from) > ${SQL_NOW}
  END`

/** Current Almaty wall-clock time as `YYYY-MM-DD HH:MM`. */
export function almatyNow(): string {
  const utc = new Date()
  const local = new Date(utc.getTime() + 5 * 60 * 60 * 1000)
  return local.toISOString().slice(0, 16).replace('T', ' ')
}

/** Adds hours to a `YYYY-MM-DD HH:MM` string, returning the same format. */
export function addHours(timestamp: string, hours: number): string {
  const base = new Date(`${timestamp.replace(' ', 'T')}:00Z`)
  const shifted = new Date(base.getTime() + hours * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 16).replace('T', ' ')
}