import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from './auth'
import { ThemeProvider } from './theme'
import type { Role, Unit } from './types'

export const STAFF: Record<Role, { id: number; name: string; phone: string; role: Role }> = {
  admin: { id: 1, name: 'Нурлан Абдразаков', phone: '+77011112233', role: 'admin' },
  housekeeper: { id: 2, name: 'Айгуль Сериккызы', phone: '+77022223344', role: 'housekeeper' },
  waiter: { id: 3, name: 'Ержан Тулеуов', phone: '+77033334455', role: 'waiter' },
}

export function makeUnit(over: Partial<Unit> = {}): Unit {
  return {
    id: 1,
    type: 'room',
    name: '101',
    category: 'standard',
    capacity: 2,
    status: 'free',
    needs_cleaning: false,
    cleaning_pending: 0,
    cleaning_total: 0,
    current_booking: null,
    next_booking: null,
    ...over,
  }
}

type RouteHandler = (url: string, init?: RequestInit) => unknown

/**
 * Stubs `fetch` with a tiny router. Keys are `METHOD /api/path` (query string
 * ignored). Matching is exact unless the key ends in `*`, and longer paths are
 * tried first — otherwise `/api/units` would swallow `/api/units/5/calendar`.
 */
export function mockApi(routes: Record<string, RouteHandler | unknown>) {
  const entries = Object.entries(routes).sort(
    ([a], [b]) => b.split(' ')[1].length - a.split(' ')[1].length
  )

  const spy = vi.spyOn(globalThis, 'fetch')
  spy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.replace(/^.*\/api/, '/api').split('?')[0]

    for (const [key, value] of entries) {
      const [routeMethod, routePath] = key.split(' ')
      if (routeMethod !== method) continue

      const isPrefix = routePath.endsWith('/') || routePath.endsWith('*')
      const matches = isPrefix
        ? path.startsWith(routePath.replace(/\*$/, ''))
        : path === routePath
      if (!matches) continue

      const body = typeof value === 'function' ? (value as RouteHandler)(url, init) : value
      return new Response(JSON.stringify(body ?? null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `no stub for ${method} ${path}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return spy
}

/** Renders with a signed-in staff member and the router in place. */
export function renderApp(ui: ReactNode, { route = '/' }: { route?: string } = {}) {
  // Mirrors the provider tree in main.tsx, theme outermost — components read
  // the palette, so a harness without it renders a different app than ships.
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </ThemeProvider>
  )
}

/**
 * Pins the Rooms page to the card grid.
 *
 * The board is the default now, so a test about cards has to say it wants
 * cards — otherwise it is silently testing a different screen.
 */
export function useCardView(): void {
  localStorage.setItem('taura_pms_rooms_view', 'cards')
}

/** Puts a token in storage so AuthProvider restores a session via /auth/me. */
export function signIn(role: Role) {
  localStorage.setItem('taura_pms_token', `test-token-${role}`)
  return STAFF[role]
}