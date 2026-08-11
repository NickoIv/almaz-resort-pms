import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DepositModal from './components/DepositModal'
import TodayPage from './pages/TodayPage'
import { mockApi, renderApp, signIn, STAFF } from './test-utils'
import type { Booking } from './types'

/**
 * §41 — возврат залога.
 *
 * The deposit has been stored and shown as «возвратный, не входит в остаток»
 * since the beginning, and nothing recorded that it went back — so «вернули ли
 * те 5 000?» had no answer anywhere in the app, and the figure sat on the
 * booking for ever.
 *
 * The arithmetic is checked against a real Worker by smoke-deposit.mjs (23
 * checks). Here: that the whole amount is the default because that is what
 * happens nearly every time, that keeping part of it cannot be done silently,
 * and that a checkout does its three things in the order that stops money
 * leaving with the wrong person.
 */

const BOOKING: Booking = {
  id: 12,
  guest_name: 'Иван Камранов',
  date_from: '2026-08-10',
  date_to: '2026-08-12',
  deposit_amount: 10000,
  currency: 'KZT',
}

function openDialog() {
  const posted: Record<string, unknown>[] = []
  mockApi({
    'GET /api/auth/me': { user: STAFF.admin },
    'POST /api/bookings/12/deposit-return': (_url: string, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      return { ...BOOKING, deposit_returned: 10000 }
    },
  })
  signIn('admin')
  renderApp(<DepositModal booking={BOOKING} onClose={vi.fn()} onSaved={vi.fn()} />)
  return posted
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('§41 возврат залога', () => {
  it('по умолчанию возвращает всё — так бывает почти всегда', async () => {
    const posted = openDialog()

    const amount = (await screen.findByLabelText('Возвращаем')) as HTMLInputElement
    expect(amount.value).toBe('10000')
    // Nothing about withholding until somebody actually withholds.
    expect(screen.queryByLabelText('За что удерживаем')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Вернуть залог' }))
    await waitFor(() => expect(posted.length).toBe(1))
    expect(posted[0].amount).toBe(10000)
  })

  it('удержать часть молча нельзя — спрашивает, за что', async () => {
    openDialog()

    const amount = await screen.findByLabelText('Возвращаем')
    await userEvent.clear(amount)
    await userEvent.type(amount, '6000')

    // «Удержано 4 000» с пустым местом рядом — начало спора, который через
    // неделю уже никто не рассудит.
    const note = await screen.findByLabelText('За что удерживаем')
    expect(note.hasAttribute('required')).toBe(true)
    expect(screen.getByRole('button', { name: 'Вернуть часть' })).toBeTruthy()
  })

  it('и говорит, куда денутся удержанные деньги', async () => {
    openDialog()

    const amount = await screen.findByLabelText('Возвращаем')
    await userEvent.clear(amount)
    await userEvent.type(amount, '6000')

    // Money the hotel keeps is money the hotel earned: it becomes a charge, or
    // it is invisible in every revenue report — the same hole as writing a
    // repair as a fake booking.
    const warning = await screen.findByText(/пойдёт в начисления/)
    expect(warning.textContent!.replace(/\s/g, '')).toContain('4000')
    expect(warning.textContent).toContain('второй раз платить не должен')
  })
})

describe('§41 выезд отдаёт залог до того, как закроет бронь', () => {
  function todayBoard(over: Record<string, unknown> = {}) {
    const patched: unknown[] = []
    mockApi({
      'GET /api/auth/me': { user: STAFF.admin },
      'GET /api/staff': [],
      'GET /api/today': {
        today: '2026-08-12',
        arrivals: [],
        staying: 0,
        blocked: [],
        departures: [
          {
            booking_id: 12, unit_id: 5, unit_name: '101', unit_type: 'room',
            guest_name: 'Иван Камранов', guest_phone: null,
            date_from: '2026-08-10', date_to: '2026-08-12', nights: 2,
            status: 'occupied', verified_at: '2026-08-10 10:00',
            needs_cleaning: false, cleaning_pending: 0, migration_due: false,
            is_paid: true, total_amount: 40000, prepaid_amount: 40000,
            deposit_amount: 10000, deposit_pending: true, charges_amount: 0,
            remaining_amount: 0, currency: 'KZT', ...over,
          },
        ],
      },
      'PATCH /api/bookings/': (_url: string, init?: RequestInit) => {
        patched.push(JSON.parse(String(init?.body ?? '{}')))
        return { ok: true }
      },
    })
    signIn('admin')
    renderApp(<TodayPage />)
    return patched
  }

  it('с неотданным залогом «Выселить» сначала открывает возврат', async () => {
    const patched = todayBoard()

    await screen.findByText(/вернуть/)
    await userEvent.click(screen.getByRole('button', { name: 'Выселить' }))

    // After the booking closes the row is off this screen and the money is
    // somebody's problem tomorrow.
    await screen.findByText('Возврат залога')
    expect(patched.length).toBe(0)
  })

  it('после возврата выселяет как обычно', async () => {
    const patched = todayBoard({ deposit_pending: false })

    await userEvent.click(await screen.findByRole('button', { name: 'Выселить' }))
    await waitFor(() => expect(patched.length).toBe(1))
    expect(patched[0]).toEqual({ status: 'free', cancel_reason: 'checked_out' })
  })
})
