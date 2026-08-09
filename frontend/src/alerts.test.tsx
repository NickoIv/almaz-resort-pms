import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeUnit, mockApi, renderApp, signIn, STAFF } from './test-utils'
import type { StaffAlert } from './useAlerts'

// The chime is mocked so "did it sound" is a question the test can ask. jsdom
// has no AudioContext, so the real module would no-op and prove nothing.
vi.mock('./sound', () => ({
  unlockSound: vi.fn(),
  isSoundUnlocked: vi.fn(() => true),
  playChime: vi.fn(),
}))
import { playChime } from './sound'

const chime = vi.mocked(playChime)

const SLA_ALERT = {
  id: 'sla:5:2026-08-09 09:00',
  kind: 'sla' as const,
  title: 'Уборка просрочена — 105',
  detail: 'ждёт 1 ч 35 мин, осталось пунктов: 3',
  href: '/cleaning',
  at: '2026-08-09 09:00',
}

const WAITLIST_ALERT = {
  id: 'waitlist:7',
  kind: 'waitlist' as const,
  title: 'Освободилось для листа ожидания — Ждущий Гость',
  detail: '«112», 2026-09-01 — 2026-09-03',
  href: '/waitlist',
  at: '2026-08-09 08:00',
}

const BOOKING_ALERT = {
  id: 'booking:91',
  kind: 'booking' as const,
  title: 'Новая бронь — Беседка 1',
  detail: 'Ержан Тулеуов забронировал для «Чужая Бронь»',
  href: '/units/20',
  at: '2026-08-09 10:00',
}

function routes(role: 'admin' | 'housekeeper' | 'waiter', alerts: unknown[], calls?: string[]) {
  return {
    'GET /api/auth/me': { user: STAFF[role] },
    'GET /api/units': [makeUnit({ id: 5, name: '105' })],
    'GET /api/cleaning': { sla_minutes: 60, units: [] },
    'GET /api/settings': { notifications: {}, telegram_configured: false },
    'GET /api/units/forecast': { total_units: 14, days: [] },
    'GET /api/settings/preview': { empty: true, sections: 0, text: '' },
    'GET /api/alerts': (url: string) => {
      calls?.push(url)
      return { sla_minutes: 60, booking_window_hours: 8, alerts }
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  chime.mockClear()
  document.title = 'Taura PMS'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('§13 alerts — appearance and acknowledgement', () => {
  it('raises a badge with the number outstanding', async () => {
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT, WAITLIST_ALERT, BOOKING_ALERT]))
    renderApp(<App />, { route: '/rooms' })

    const bell = await screen.findByRole('button', { name: /Событий, требующих внимания: 3/ })
    expect(bell).toBeInTheDocument()
    expect(within(bell).getByText('3')).toBeInTheDocument()
  })

  it('stays silent and hidden when there is nothing outstanding', async () => {
    signIn('admin')
    mockApi(routes('admin', []))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('heading', { name: 'Номера' })
    expect(screen.queryByRole('button', { name: /Событий, требующих внимания/ })).toBeNull()
    expect(chime).not.toHaveBeenCalled()
  })

  it('lists each alert with a link to the page that can act on it', async () => {
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT, WAITLIST_ALERT, BOOKING_ALERT]))
    renderApp(<App />, { route: '/rooms' })

    await userEvent.click(await screen.findByRole('button', { name: /Событий/ }))

    const panel = screen.getByRole('dialog', { name: 'Требуют внимания' })
    expect(within(panel).getByRole('link', { name: SLA_ALERT.title })).toHaveAttribute(
      'href',
      '/cleaning'
    )
    expect(within(panel).getByRole('link', { name: WAITLIST_ALERT.title })).toHaveAttribute(
      'href',
      '/waitlist'
    )
    expect(within(panel).getByRole('link', { name: BOOKING_ALERT.title })).toHaveAttribute(
      'href',
      '/units/20'
    )
  })

  it('drops an alert when it is acknowledged, and remembers that', async () => {
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT, WAITLIST_ALERT]))
    renderApp(<App />, { route: '/rooms' })

    await userEvent.click(await screen.findByRole('button', { name: /Событий/ }))
    await userEvent.click(
      screen.getByRole('button', { name: `Отметить как прочитанное: ${SLA_ALERT.title}` })
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Событий, требующих внимания: 1/ })).toBeTruthy()
    )
    // Dismissal survives a reload; the badge must not come back tomorrow.
    expect(JSON.parse(localStorage.getItem('taura_pms_acked_alerts')!)).toContain(SLA_ALERT.id)
  })

  it('hides the badge entirely once everything is acknowledged', async () => {
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT, WAITLIST_ALERT]))
    renderApp(<App />, { route: '/rooms' })

    await userEvent.click(await screen.findByRole('button', { name: /Событий/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Отметить все' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Событий, требующих внимания/ })).toBeNull()
    )
  })

  it('does not resurrect an alert that was already dismissed', async () => {
    localStorage.setItem('taura_pms_acked_alerts', JSON.stringify([SLA_ALERT.id]))
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT, WAITLIST_ALERT]))
    renderApp(<App />, { route: '/rooms' })

    // Only the one that was never dismissed is counted.
    expect(
      await screen.findByRole('button', { name: /Событий, требующих внимания: 1/ })
    ).toBeInTheDocument()
  })
})

describe('§13 alerts — sound fires per event, not per poll', () => {
  it('sounds once when alerts first arrive', async () => {
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT, WAITLIST_ALERT]))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /Событий/ })
    // Two new alerts, one chime: ten overdue rooms is one event to a person.
    expect(chime).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the same alerts come back on the next poll', async () => {
    const calls: string[] = []
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT], calls))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /Событий/ })
    expect(chime).toHaveBeenCalledTimes(1)

    // Returning to the tab re-polls; nothing has changed, so nothing sounds.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
    expect(chime).toHaveBeenCalledTimes(1)
  })

  it('sounds again only for an alert that is genuinely new', async () => {
    let payload: StaffAlert[] = [SLA_ALERT]
    signIn('admin')
    mockApi({
      ...routes('admin', []),
      'GET /api/alerts': () => ({ sla_minutes: 60, booking_window_hours: 8, alerts: payload }),
    })
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /Событий, требующих внимания: 1/ })
    expect(chime).toHaveBeenCalledTimes(1)

    payload = [SLA_ALERT, BOOKING_ALERT]
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await screen.findByRole('button', { name: /Событий, требующих внимания: 2/ })
    expect(chime).toHaveBeenCalledTimes(2)
  })

  it('does not sound for an alert the user has already dismissed', async () => {
    localStorage.setItem('taura_pms_acked_alerts', JSON.stringify([SLA_ALERT.id]))
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT]))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(chime).not.toHaveBeenCalled())
  })
})

describe('§13 alerts — role scope', () => {
  it('polls for a housekeeper', async () => {
    const calls: string[] = []
    signIn('housekeeper')
    mockApi({
      ...routes('housekeeper', [SLA_ALERT], calls),
      'GET /api/cleaning/unit/': [],
    })
    renderApp(<App />, { route: '/cleaning' })

    await screen.findByRole('button', { name: /Событий, требующих внимания: 1/ })
    expect(calls.length).toBeGreaterThan(0)
  })

  it('never asks on behalf of a waiter', async () => {
    const calls: string[] = []
    signIn('waiter')
    mockApi(routes('waiter', [], calls))
    renderApp(<App />, { route: '/restaurant' })

    await screen.findByRole('heading', { name: 'Зона отдыха' })
    // Waiters have no alerts of their own; the request would only earn a 403.
    expect(calls).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Событий/ })).toBeNull()
  })
})

describe('§13 alerts — tab title', () => {
  it('flashes while the tab is in the background and restores it on return', async () => {
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT]))

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false)

    renderApp(<App />, { route: '/rooms' })
    await screen.findByRole('button', { name: /Событий/ })

    // Swap in fake timers, then drive a real return-and-leave so the interval
    // is recreated under them: the one started at mount is a real timer that
    // advanceTimersByTime would never touch.
    vi.useFakeTimers()

    hidden.mockReturnValue(false)
    focused.mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(document.title).toBe('Taura PMS')

    hidden.mockReturnValue(true)
    focused.mockReturnValue(false)
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(1000)
    })
    expect(document.title).toBe('⚠ Новое событие — Taura PMS')

    // Alternates rather than sticking on the warning.
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(document.title).toBe('Taura PMS')

    // Back to the tab: the normal title returns at once, and stays put even
    // though the clock keeps running.
    hidden.mockReturnValue(false)
    focused.mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(document.title).toBe('Taura PMS')
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(document.title).toBe('Taura PMS')

    hidden.mockRestore()
    focused.mockRestore()
  })

  it('leaves the title alone while the tab is being looked at', async () => {
    signIn('admin')
    mockApi(routes('admin', [SLA_ALERT]))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)

    renderApp(<App />, { route: '/rooms' })
    await screen.findByRole('button', { name: /Событий/ })

    vi.useFakeTimers()
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(document.title).toBe('Taura PMS')
  })
})