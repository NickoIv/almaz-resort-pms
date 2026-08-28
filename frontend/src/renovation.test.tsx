import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UnitCard from './components/UnitCard'
import RoomsPage from './pages/RoomsPage'
import { makeUnit, mockApi, renderApp, signIn, STAFF, useCardView } from './test-utils'

/**
 * §44 — объект на реставрации.
 *
 * Корпус ещё строится: номера заведены, потому что они спланированы и оценены,
 * но их физически нет. Единственное, чего приложение не должно позволить, —
 * продать ночь в номере без крыши.
 *
 * Здесь проверяется то, что видит человек. Отказы на всех пяти путях записи
 * брони и уход из знаменателя проверяются против живого Worker'а в
 * `smoke-renovation.mjs` (24 проверки).
 */

const RENOVATING = makeUnit({
  id: 9,
  name: '109',
  status: 'free',
  renovation: { since: '2026-08-01', note: 'Корпус, до открытия', by_name: 'Нурлан' },
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('§44 карточка не предлагает продать то, чего нет', () => {
  it('вместо «Свободен» говорит «На реставрации»', () => {
    mockApi({ 'GET /api/auth/me': { user: STAFF.admin } })
    signIn('admin')
    renderApp(<UnitCard unit={RENOVATING} onOpen={vi.fn()} />)

    // Статус вытесняется, а не встаёт рядом: «свободен» на объекте, которого
    // нет, — это приглашение его продать. И сказано это **один раз**: плашка
    // называет состояние, текст под ней — причину, а не то же слово повторно.
    expect(screen.getByText('На реставрации')).toBeTruthy()
    expect(screen.queryByText('Свободен')).toBeNull()
  })

  it('и показывает пояснение там, где был бы гость', () => {
    mockApi({ 'GET /api/auth/me': { user: STAFF.admin } })
    signIn('admin')
    renderApp(<UnitCard unit={RENOVATING} onOpen={vi.fn()} />)

    // «Нет брони» здесь сказало бы правду и обмануло: брони действительно нет,
    // но продать всё равно нельзя.
    expect(screen.getByText('Корпус, до открытия')).toBeTruthy()
    expect(screen.queryByText('Нет брони')).toBeNull()
  })
})

describe('§44 счётчики считают то, что можно продать', () => {
  function grid(units: ReturnType<typeof makeUnit>[]) {
    mockApi({
      'GET /api/auth/me': { user: STAFF.admin },
      'GET /api/units': units,
      'GET /api/staff': [],
    })
    signIn('admin')
    useCardView()
    renderApp(<RoomsPage />)
  }

  it('объект на реставрации не входит в «сколько у нас номеров»', async () => {
    grid([
      makeUnit({ id: 1, name: '101' }),
      makeUnit({ id: 2, name: '102' }),
      RENOVATING,
    ])

    // Не «3 номера», из которых один не существует: знаменатель, в котором
    // сидит стройка, даёт вечную загрузку в две трети и отвечает на вопрос,
    // которого никто не задавал.
    await screen.findByText(/2 номеров/)
    expect(screen.getByText(/1 на реставрации/)).toBeTruthy()
  })
})
