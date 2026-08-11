import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TodayPage from './pages/TodayPage'
import { mockApi, renderApp, signIn, STAFF } from './test-utils'
import type { Role } from './types'

/**
 * §40 — «Сегодня»: кто заезжает, кто выезжает.
 *
 * The app answered this with a number on a tile that led to the board, where
 * three arrivals had to be found by reading down a column of fourteen rooms.
 *
 * The arithmetic — which booking belongs on which list — is checked against a
 * real Worker by smoke-today.mjs (29 checks). What is checked here is the thing
 * a server test cannot see: that everything which has to be dealt with **before
 * the button is pressed** is on the row, and that a departure with a balance
 * cannot quietly become a checkout.
 */

function row(over: Record<string, unknown> = {}) {
  return {
    booking_id: 1,
    unit_id: 5,
    unit_name: '101',
    unit_type: 'room',
    guest_name: 'Иван Камранов',
    guest_phone: '+7 700 111 22 33',
    date_from: '2026-08-12',
    date_to: '2026-08-15',
    nights: 3,
    status: 'booked',
    verified_at: '2026-08-11 10:00',
    needs_cleaning: false,
    cleaning_pending: 0,
    migration_due: false,
    is_paid: true,
    total_amount: 30000,
    prepaid_amount: 30000,
    deposit_amount: 0,
    charges_amount: 0,
    remaining_amount: 0,
    currency: 'KZT',
    ...over,
  }
}

function board(over: Record<string, unknown> = {}) {
  return {
    today: '2026-08-12',
    arrivals: [],
    departures: [],
    staying: 4,
    blocked: [],
    ...over,
  }
}

function open(data: unknown, role: Role = 'admin') {
  const patched: { path: string; body: unknown }[] = []
  mockApi({
    'GET /api/auth/me': { user: STAFF[role] },
    'GET /api/today': data,
    'GET /api/staff': [],
    'PATCH /api/bookings/': (url: string, init?: RequestInit) => {
      patched.push({ path: url, body: JSON.parse(String(init?.body ?? '{}')) })
      return { ok: true }
    },
  })
  signIn(role)
  renderApp(<TodayPage />)
  return patched
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('§40 «Сегодня» показывает работу, а не число', () => {
  it('заезды и выезды — двумя списками, с именами', async () => {
    open(
      board({
        arrivals: [row({ booking_id: 1, guest_name: 'Иван Камранов' })],
        departures: [row({ booking_id: 2, unit_name: '104', guest_name: 'Пётр Ким' })],
      })
    )

    await screen.findByRole('heading', { name: 'Сегодня' })
    // The guest's name shares its element with the room link, so it is matched
    // as a fragment rather than as a whole text node.
    expect(screen.getByText(/Иван Камранов/)).toBeTruthy()
    expect(screen.getByText(/Пётр Ким/)).toBeTruthy()
    // The tile it replaces said "3" and left the finding to the reader.
    expect(screen.getByRole('button', { name: 'Заселить' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Выселить' })).toBeTruthy()
  })

  it('в спокойный день так и говорит, а не показывает два пустых списка', async () => {
    open(board({ staying: 6 }))
    await screen.findByText(/Спокойный день/)
    expect(screen.getByText(/Проживают 6/)).toBeTruthy()
  })

  it('телефон — кнопка набора, а не строчка текста', async () => {
    open(board({ arrivals: [row()] }))

    const phone = (await screen.findByText('+7 700 111 22 33')) as HTMLAnchorElement
    // Measured at 16px tall against the app's 40px floor while it lived inside
    // the caption; it is a control now, and dialling is what it is for.
    expect(phone.tagName).toBe('A')
    expect(phone.getAttribute('href')).toBe('tel:+77001112233')
  })
})

describe('§40 всё, что может пойти не так, сказано до нажатия', () => {
  it('номер под заезд не убран — и это видно на строке', async () => {
    open(board({ arrivals: [row({ needs_cleaning: true, cleaning_pending: 8 })] }))

    await screen.findByText(/не убран · 8/)
    // Не просто подпись: строка помечена, как просроченная уборка в сводке.
    expect(document.querySelector('.row-card.is-overdue')).toBeTruthy()
  })

  it('иностранный гость — про миграционный учёт сказано, пока паспорт на столе', async () => {
    open(board({ arrivals: [row({ migration_due: true })] }))
    await screen.findByText('миграционный учёт')
  })

  it('непроверенная бронь помечена только на заезде', async () => {
    open(
      board({
        arrivals: [row({ booking_id: 1, verified_at: null })],
        departures: [row({ booking_id: 2, verified_at: null })],
      })
    )
    // On a departure the check is three days late to be worth mentioning.
    await waitFor(() => expect(screen.getAllByText('не проверена').length).toBe(1))
  })

  it('снятые с продажи названы здесь же', async () => {
    open(
      board({
        blocked: [{ id: 1, unit_name: '107', reason: 'repair', note: null, date_to: '2026-08-15' }],
      })
    )
    const notice = await screen.findByText(/Сняты с продажи/)
    expect(notice.parentElement!.textContent).toContain('107')
    expect(notice.parentElement!.textContent).toContain('ремонт')
  })
})

describe('§40 кнопки', () => {
  it('«Заселить» переводит бронь в «занят», а не выдумывает новую', async () => {
    const patched = open(board({ arrivals: [row()] }))

    await userEvent.click(await screen.findByRole('button', { name: 'Заселить' }))
    await waitFor(() => expect(patched.length).toBe(1))
    expect(patched[0].path).toContain('/bookings/1')
    expect(patched[0].body).toEqual({ status: 'occupied' })
  })

  it('уже заселённого не предлагает заселить второй раз', async () => {
    open(board({ arrivals: [row({ status: 'occupied' })] }))
    const button = (await screen.findByRole('button', { name: 'Заселён' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('«Выселить» без долга закрывает бронь обычным выездом', async () => {
    const patched = open(board({ departures: [row({ remaining_amount: 0 })] }))

    await userEvent.click(await screen.findByRole('button', { name: 'Выселить' }))
    await waitFor(() => expect(patched.length).toBe(1))
    // The same path the booking form has always used, so cleaning and the
    // waitlist prompt keep working — nothing new had to be invented.
    expect(patched[0].body).toEqual({ status: 'free', cancel_reason: 'checked_out' })
  })

  it('с долгом сначала показывает оплату и НЕ выселяет', async () => {
    const patched = open(board({ departures: [row({ remaining_amount: 25000, is_paid: false })] }))

    await screen.findByText(/долг/)
    await userEvent.click(screen.getByRole('button', { name: 'Выселить' }))

    // Выезд — это момент, когда берут деньги. Ключ уходит после них, а не до.
    await screen.findByText('Внести оплату')
    expect(patched.length).toBe(0)
  })
})

describe('§40 официант видит своё и не видит сумм', () => {
  it('вместо остатка — только «оплачено / не оплачено»', async () => {
    // The server withholds the amounts; the page must not imply they are zero.
    const { total_amount, prepaid_amount, remaining_amount, deposit_amount, charges_amount, currency, ...noMoney } =
      row({ is_paid: false, unit_type: 'gazebo', unit_name: 'Беседка 1' })
    void total_amount; void prepaid_amount; void remaining_amount
    void deposit_amount; void charges_amount; void currency

    open(board({ arrivals: [noMoney] }), 'waiter')

    await screen.findByText('не оплачено')
    expect(screen.queryByText(/долг/)).toBeNull()
  })
})
