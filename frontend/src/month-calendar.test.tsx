import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MonthCalendar from './components/MonthCalendar'
import type { CalendarDay } from './types'

/**
 * The month grid draws whatever the API hands it, so what is testable here is
 * the drawing: every day of the month present, and the 1st sitting under the
 * right weekday. The column offset is Monday-based and computed in UTC — an
 * off-by-one there slides the whole month sideways, which reads as the room
 * being busy on days it is not, and is the kind of thing nobody notices until a
 * guest is turned away.
 */
function monthOf(month: string, length: number): CalendarDay[] {
  return Array.from({ length }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, '0')}`,
    status: 'free' as const,
    booking_id: null,
    guest_name: null,
  }))
}

describe('§22 the month grid draws a whole month, aligned to the right weekday', () => {
  const cells = () => [...document.querySelectorAll('.cal-day:not(.is-empty)')]
  const blanks = () => document.querySelectorAll('.cal-day.is-empty').length

  it.each([
    ['2027-03', 31, 0], // a month that begins on a Monday: no offset at all
    ['2027-08', 31, 6], // begins on a Sunday: the worst case, a full week short
    ['2028-02', 29, 1], // leap February, beginning on a Tuesday
    ['2027-04', 30, 3],
  ])('%s has %i days and %i leading blanks', (month, length, expectedBlanks) => {
    render(<MonthCalendar days={monthOf(month, length)} />)

    expect(cells()).toHaveLength(length)
    expect(blanks()).toBe(expectedBlanks)
    // First and last cell carry the day number, not the ISO string.
    expect(cells()[0].textContent).toBe('1')
    expect(cells().at(-1)!.textContent).toBe(String(length))
  })

  it('shades only the days the API called busy', () => {
    const days = monthOf('2027-03', 31)
    // A stay of 15→18: the nights of the 15th, 16th and 17th. The 18th is the
    // checkout morning and must stay free — the server used to send it as
    // booked, which made every stay look a day longer than it was.
    for (const day of [15, 16, 17]) days[day - 1].status = 'occupied'

    render(<MonthCalendar days={days} />)

    const busy = cells().filter((cell) => cell.getAttribute('data-status') !== 'free')
    expect(busy.map((cell) => cell.textContent)).toEqual(['15', '16', '17'])
  })

  it('renders nothing rather than throwing when the month is missing', () => {
    const { container } = render(<MonthCalendar days={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
