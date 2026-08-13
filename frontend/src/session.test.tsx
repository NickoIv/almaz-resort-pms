import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { RequireRole } from './auth'
import LoginPage from './pages/LoginPage'
import TodayPage from './pages/TodayPage'
import { mockApi, renderApp, signIn, STAFF } from './test-utils'

/**
 * §43 — конец сессии.
 *
 * Жалоба со стойки: утром приложение показывало «Missing bearer token» на
 * странице «Сегодня», при этом в шапке стояло имя администратора и работало
 * меню. Ни то, ни другое не было ошибкой самой страницы: токен живёт двенадцать
 * часов, вкладку на ночь не закрывают, утренний опрос получил 401, `api`
 * стёрла токен — и каждый следующий запрос уходил без заголовка. А `user` при
 * этом остался в памяти React, поэтому приложение продолжало вести себя как
 * вошедшее и показывать красное вместо экрана PIN-кода.
 *
 * Со стороны это неотличимо от поломки, и починка («нажать Выйти») — не то, о
 * чём стойка должна догадываться.
 */

const EXPIRED = () =>
  new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/today"
        element={
          <RequireRole roles={['admin']}>
            <TodayPage />
          </RequireRole>
        }
      />
    </Routes>
  )
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('§43 истёкший токен уводит на вход, а не в красную полосу', () => {
  it('страница, получившая 401, оказывается экраном PIN-кода', async () => {
    mockApi({
      'GET /api/auth/me': { user: STAFF.admin },
      'GET /api/today': EXPIRED,
    })
    signIn('admin')
    renderApp(<App />, { route: '/today' })

    // Не «Missing bearer token» под шапкой с именем администратора.
    await screen.findByLabelText('PIN-код')
    expect(screen.queryByText(/bearer|токен/i)).toBeNull()
  })

  it('и говорит, почему спрашивает PIN снова', async () => {
    mockApi({
      'GET /api/auth/me': { user: STAFF.admin },
      'GET /api/today': EXPIRED,
    })
    signIn('admin')
    renderApp(<App />, { route: '/today' })

    // Иначе утренний PIN выглядит так, будто приложение забыло вчерашний вход
    // просто так, — и следующий вопрос будет «оно сломалось?».
    await screen.findByText(/Вход действует одну смену/)
  })

  it('мёртвый токен не остаётся в хранилище', async () => {
    mockApi({
      'GET /api/auth/me': { user: STAFF.admin },
      'GET /api/today': EXPIRED,
    })
    signIn('admin')
    renderApp(<App />, { route: '/today' })

    await screen.findByLabelText('PIN-код')
    expect(localStorage.getItem('taura_pms_token')).toBeNull()
  })

  it('после входа возвращает туда, где человека застало', async () => {
    const board = {
      today: '2026-08-13',
      arrivals: [],
      departures: [],
      staying: 0,
      blocked: [],
    }
    let live = false
    mockApi({
      'GET /api/auth/me': { user: STAFF.admin },
      'GET /api/staff': [],
      'POST /api/auth/login': () => {
        live = true
        return { token: 'fresh', user: STAFF.admin }
      },
      // До входа сервер отвечает отказом, после — как обычно.
      'GET /api/today': () => (live ? new Response(JSON.stringify(board), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) : EXPIRED()),
    })
    signIn('admin')
    renderApp(<App />, { route: '/today' })

    await userEvent.type(await screen.findByLabelText('Телефон'), STAFF.admin.phone)
    await userEvent.type(screen.getByLabelText('PIN-код'), '1234')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))

    // А не на сводку: человек стоял на «Сегодня» с гостем перед собой.
    await screen.findByRole('heading', { name: 'Сегодня' })
  })
})

describe('§43 неверный PIN — это не истёкшая сессия', () => {
  it('говорит про PIN и молчит про смену', async () => {
    mockApi({
      'POST /api/auth/login': () =>
        new Response(JSON.stringify({ error: 'Invalid phone or PIN' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    })
    renderApp(<LoginPage />, { route: '/login' })

    await userEvent.type(await screen.findByLabelText('Телефон'), '+77011112233')
    await userEvent.type(screen.getByLabelText('PIN-код'), '9999')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await screen.findByText('Invalid phone or PIN')
    // «Вход действует одну смену» человеку, который промахнулся по цифре, —
    // подсказка не про то, и уводит от настоящей причины.
    await waitFor(() => expect(screen.queryByText(/Вход действует одну смену/)).toBeNull())
  })
})
