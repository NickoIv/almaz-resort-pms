import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { makeUnit, mockApi, renderApp, signIn, STAFF } from './test-utils'

/**
 * §37 — a page must not be a photograph of the moment it was opened.
 *
 * The desk had two complaints that turned out to be the same one: a signal that
 * stayed up after the booking behind it was closed, and a picture that did not
 * follow what was actually happening. Only the bell ever re-asked the server;
 * every page held whatever it had loaded, however long it was left open — and
 * this hotel is worked by three people at once, on a desktop and two phones.
 *
 * The rule taken from working systems (TanStack Query refetches on window focus
 * by default, and adds an interval for shared screens): re-ask after a write,
 * on returning to the tab, and slowly in the background — never with a spinner
 * over data that is already on screen, and never from a hidden tab.
 */
function useCardView() {
  localStorage.setItem('taura_pms_rooms_view', 'cards')
}

function routes(units: unknown[], calls: { n: number }) {
  return {
    'GET /api/auth/me': { user: STAFF.admin },
    'GET /api/alerts': { sla_minutes: 60, booking_window_hours: 8, alerts: [] },
    'GET /api/cleaning': { sla_minutes: 60, units: [] },
    'GET /api/units': (_url: string) => {
      calls.n += 1
      return units
    },
    'PATCH /api/bookings/': { ok: true },
  }
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

afterEach(() => {
  setHidden(false)
  localStorage.clear()
})

describe('§37 страницы догоняют то, что происходит в гостинице', () => {
  it('перечитывает список после чужой записи на сервер', async () => {
    signIn('admin')
    useCardView()
    const calls = { n: 0 }
    const units = [makeUnit({ id: 5, name: '105', status: 'free' })]
    mockApi(routes(units, calls))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(calls.n).toBeGreaterThan(0))
    const before = calls.n

    // Somebody checks a guest in — from another page, another tab, another
    // person's phone. All this screen sees is that a write happened.
    const { api } = await import('./api')
    await act(async () => {
      await api('/bookings/1', { method: 'PATCH', body: { status: 'occupied' } })
    })

    await waitFor(() => expect(calls.n).toBeGreaterThan(before), { timeout: 2000 })
  })

  it('перечитывает при возвращении на вкладку', async () => {
    signIn('admin')
    useCardView()
    const calls = { n: 0 }
    mockApi(routes([makeUnit({ id: 5, name: '105' })], calls))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(calls.n).toBeGreaterThan(0))
    const before = calls.n

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(calls.n).toBeGreaterThan(before))
  })

  it('со скрытой вкладки не спрашивает ничего', async () => {
    signIn('admin')
    useCardView()
    const calls = { n: 0 }
    mockApi(routes([makeUnit({ id: 5, name: '105' })], calls))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(calls.n).toBeGreaterThan(0))
    const before = calls.n

    // A phone in a pocket costs the hotel nothing.
    setHidden(true)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    expect(calls.n).toBe(before)
  })

  it('обновляет молча — не гасит спиннером то, что уже на экране', async () => {
    signIn('admin')
    useCardView()
    const calls = { n: 0 }
    mockApi(routes([makeUnit({ id: 5, name: '105' })], calls))
    renderApp(<App />, { route: '/rooms' })

    expect(await screen.findByText('105')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    // The room never blinks out: a spinner over a list someone is reading — or
    // a checklist someone is ticking — is worse than the staleness it cures.
    expect(screen.getByText('105')).toBeInTheDocument()
    await waitFor(() => expect(calls.n).toBeGreaterThan(1))
    expect(screen.getByText('105')).toBeInTheDocument()
  })
})

describe('§37 связь пропала и вернулась', () => {
  it('перечитывает, когда сеть вернулась', async () => {
    signIn('admin')
    useCardView()
    const calls = { n: 0 }
    mockApi(routes([makeUnit({ id: 5, name: '105' })], calls))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(calls.n).toBeGreaterThan(0))
    const before = calls.n

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(calls.n).toBeGreaterThan(before))
  })
})
