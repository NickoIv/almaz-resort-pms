import { rangeLabel } from './components/RoomTimeline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addDaysIso,
  almatyClock,
  almatyMonth,
  almatyMonthStart,
  almatyYear,
  dateRange,
  shortDate,
  todayIso,
} from './format'

/**
 * These assertions must hold identically under every device timezone.
 * `npm run test:tz` re-runs the whole suite under UTC+5, +7, -4, +14, -11 and
 * UTC — the automatable equivalent of overriding the timezone in DevTools, and
 * across more zones than is practical by hand. The expected values below never
 * change; only the device timezone does.
 */

describe('Almaty time helpers', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  describe('late evening UTC — Almaty has already rolled over', () => {
    // 21:30 UTC = 02:30 next day in Almaty (+5).
    beforeEach(() => vi.setSystemTime(new Date('2026-08-08T21:30:00Z')))

    it('todayIso returns the hotel date, not the UTC date', () => {
      expect(todayIso()).toBe('2026-08-09')
    })

    it('almatyClock shows hotel wall-clock time', () => {
      expect(almatyClock()).toBe('02:30')
    })

    it('almatyMonth follows the hotel date', () => {
      expect(almatyMonth()).toBe('2026-08')
    })
  })

  describe('evening UTC — a UTC+7 device is already on the next day, Almaty is not', () => {
    // 18:30 UTC = 23:30 in Almaty (still the 8th), 01:30 on the 9th in UTC+7.
    // This is the case that broke for an admin travelling in Vietnam.
    beforeEach(() => vi.setSystemTime(new Date('2026-08-08T18:30:00Z')))

    it('todayIso stays on the hotel day', () => {
      expect(todayIso()).toBe('2026-08-08')
    })

    it('almatyClock shows 23:30', () => {
      expect(almatyClock()).toBe('23:30')
    })

    it('the default checkout is the day after the hotel day', () => {
      expect(addDaysIso(todayIso(), 1)).toBe('2026-08-09')
    })
  })

  describe('early UTC — a UTC-4 device is still on the previous day', () => {
    // 02:30 UTC = 07:30 in Almaty (the 8th), 22:30 on the 7th in New York.
    beforeEach(() => vi.setSystemTime(new Date('2026-08-08T02:30:00Z')))

    it('todayIso stays on the hotel day', () => {
      expect(todayIso()).toBe('2026-08-08')
    })

    it('almatyClock shows 07:30', () => {
      expect(almatyClock()).toBe('07:30')
    })
  })

  describe('month and year boundaries', () => {
    it('rolls the month over on the hotel clock', () => {
      // 20:00 UTC on 31 Aug = 01:00 on 1 Sep in Almaty.
      vi.setSystemTime(new Date('2026-08-31T20:00:00Z'))
      expect(todayIso()).toBe('2026-09-01')
      expect(almatyMonth()).toBe('2026-09')
      expect(almatyMonthStart(0)).toBe('2026-09-01')
      expect(almatyMonthStart(-1)).toBe('2026-08-01')
    })

    it('rolls the year over on the hotel clock', () => {
      // 19:30 UTC on 31 Dec = 00:30 on 1 Jan in Almaty.
      vi.setSystemTime(new Date('2026-12-31T19:30:00Z'))
      expect(todayIso()).toBe('2027-01-01')
      expect(almatyYear()).toBe(2027)
      expect(almatyMonthStart(0)).toBe('2027-01-01')
    })
  })
})

describe('date arithmetic is timezone-independent', () => {
  it('adds days without drifting', () => {
    expect(addDaysIso('2026-08-08', 1)).toBe('2026-08-09')
    expect(addDaysIso('2026-08-08', 0)).toBe('2026-08-08')
    expect(addDaysIso('2026-08-08', -1)).toBe('2026-08-07')
  })

  it('crosses month and year boundaries', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('handles a leap day', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysIso('2028-02-29', 1)).toBe('2028-03-01')
  })
})

describe('date rendering is timezone-independent', () => {
  it('renders a date-only value as the day it names', () => {
    expect(shortDate('2026-08-08')).toBe('8 авг.')
    expect(shortDate('2026-01-01')).toBe('1 янв.')
    expect(shortDate('2026-12-31')).toBe('31 дек.')
  })

  it('renders a range without shifting either end', () => {
    expect(dateRange('2026-08-08', '2026-08-11')).toBe('8 авг. — 11 авг.')
  })
})

/**
 * The planning board's range label.
 *
 * It exists because on a phone the board can only show six columns, so
 * switching from a week to a month loaded thirty days while the screen kept
 * showing the same six — the control looked broken. This label is the part
 * that always changes, so what it says has to be right.
 */
describe('rangeLabel — what span the board is showing', () => {
  it('writes the month once when both ends share it', () => {
    expect(rangeLabel('2026-08-10', 7)).toBe('10 — 16 авг')
  })

  it('writes both months when the span crosses one', () => {
    expect(rangeLabel('2026-08-10', 30)).toBe('10 авг — 8 сен')
  })

  it('counts the last day inclusively, not one past it', () => {
    // Seven days from the 10th ends on the 16th, not the 17th — the same
    // half-open convention the bookings use would be wrong for a label.
    expect(rangeLabel('2026-08-10', 1)).toBe('10 — 10 авг')
  })

  it('crosses a year end without going backwards', () => {
    expect(rangeLabel('2026-12-28', 7)).toBe('28 дек — 3 янв')
  })
})
