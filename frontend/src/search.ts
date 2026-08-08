import { shortDate } from './format'
import type { Unit } from './types'

/** Digits only, so "+7 (701) 111-22-33" and "87011112233" both match "7011". */
export function digits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Free-text match for the Rooms search box.
 *
 * Matches the room name and category, the guest's name, the phone (ignoring
 * punctuation), and the check-in date in either the stored `2026-08-14` form or
 * the displayed `14 авг` form — whichever the user happens to type.
 * Both the current and the upcoming booking are searchable.
 */
export function matchesQuery(unit: Unit, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true

  const haystacks: string[] = [unit.name.toLowerCase(), (unit.category ?? '').toLowerCase()]

  for (const booking of [unit.current_booking, unit.next_booking]) {
    if (!booking) continue
    if (booking.guest_name) haystacks.push(booking.guest_name.toLowerCase())
    if (booking.guest_phone) haystacks.push(booking.guest_phone.toLowerCase())
    if (booking.date_from) {
      haystacks.push(booking.date_from.slice(0, 10))
      haystacks.push(shortDate(booking.date_from).toLowerCase())
    }
    if (booking.date_to) haystacks.push(booking.date_to.slice(0, 10))
  }

  if (haystacks.some((value) => value.includes(q))) return true

  // Phone search: compare digits so formatting never blocks a match. Needs at
  // least three digits, otherwise "7" would match nearly every guest.
  const qDigits = digits(q)
  if (qDigits.length >= 3) {
    for (const booking of [unit.current_booking, unit.next_booking]) {
      if (booking?.guest_phone && digits(booking.guest_phone).includes(qDigits)) return true
    }
  }

  return false
}