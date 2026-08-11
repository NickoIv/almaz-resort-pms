import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferModal from './components/TransferModal'
import { describeAudit, type AuditEntry } from './audit'
import { REASON_LABELS, CANCEL_REASONS } from './cancellation'
import { mockApi, renderApp, signIn, STAFF } from './test-utils'
import type { Booking } from './types'

/**
 * §38 — переселение: moving a guest without losing their stay.
 *
 * Until this existed the only way to move somebody was to cancel their booking
 * and write a new one, which threw away the payments, the extra charges, the
 * verification stamp, the group, the migration notice and the guest's history —
 * every fact about the stay except the one that changed.
 *
 * These tests are about what the dialog *tells* the person pressing the button.
 * The arithmetic and the writes are covered against a real Worker by
 * smoke-transfer.mjs (51 checks); what cannot be checked there is whether the
 * consequence is visible before it happens, and that is the whole job of this
 * screen: a room move rearranges money, and money that moves without being
 * shown first is how a desk stops trusting what is on the screen.
 */

const BOOKING: Booking = {
  id: 12,
  unit_id: 1,
  guest_name: 'Иван Камранов',
  guest_phone: '+77011110000',
  date_from: '2026-08-09',
  date_to: '2026-08-14',
  status: 'occupied',
  total_amount: 50000,
  prepaid_amount: 50000,
  deposit_amount: 5000,
  charges_amount: 0,
  remaining_amount: 0,
  currency: 'KZT',
}

/** The server's reading of a stay already under way: it splits at today. */
const SPLIT_PLAN = {
  mode: 'split',
  split_on: '2026-08-11',
  moved_from: '2026-08-11',
  date_to: '2026-08-14',
  nights_before: 2,
  nights_after: 3,
  from_unit: { id: 1, name: '101', type: 'room' },
  currency: 'KZT',
  total_amount: 50000,
  prepaid_amount: 50000,
  charges_amount: 0,
  deposit_amount: 5000,
  suggested_stay_amount: 20000,
  suggested_move_amount: 30000,
  units: [
    {
      id: 5, name: '105', category: 'lux', capacity: 3,
      free: true, taken_by: null, needs_cleaning: false, quote: 36000,
    },
    {
      id: 6, name: '106', category: 'standard', capacity: 2,
      free: false, taken_by: 'Пётр Ким', needs_cleaning: false, quote: null,
    },
  ],
}

const WHOLE_PLAN = {
  ...SPLIT_PLAN,
  mode: 'whole',
  split_on: null,
  moved_from: '2026-08-20',
  date_to: '2026-08-23',
  nights_before: 0,
  nights_after: 3,
  suggested_stay_amount: 0,
  suggested_move_amount: 50000,
}

function transferResult(over: Record<string, unknown> = {}) {
  return {
    mode: 'split',
    from_unit: { id: 1, name: '101' },
    to_unit: { id: 5, name: '105' },
    split_on: '2026-08-11',
    carried_amount: 30000,
    booking: { ...BOOKING, id: 13, unit_id: 5, total_amount: 30000, prepaid_amount: 30000, remaining_amount: 0 },
    previous: { ...BOOKING, status: 'free', total_amount: 20000, prepaid_amount: 20000, remaining_amount: 0 },
    ...over,
  }
}

function open(plan: unknown, result: unknown = transferResult(), onSaved = vi.fn()) {
  const posted: Record<string, unknown>[] = []
  mockApi({
    'GET /api/auth/me': { user: STAFF.admin },
    'GET /api/bookings/12/transfer-targets': plan,
    'POST /api/bookings/12/transfer': (_url: string, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      return result
    },
  })
  signIn('admin')
  renderApp(
    <TransferModal
      booking={BOOKING}
      unitName="101"
      canSetPrice
      onClose={vi.fn()}
      onSaved={onSaved}
    />
  )
  return { posted, onSaved }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('§38 переселение показывает последствие до того, как оно случится', () => {
  it('говорит, что заезд разделится, и на каком дне', async () => {
    open(SPLIT_PLAN)

    // The shape is stated, not offered: it follows from the dates, and a switch
    // here would only be a way to record nights in a room nobody slept in.
    await screen.findByText(/Гость уже живёт в «101»/)
    expect(screen.getByText(/2 ночи прожито/)).toBeTruthy()
    expect(screen.getByText(/оставшиеся 3 ночи/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Разделить/ })).toBeNull()
  })

  it('для брони, куда ещё не заехали, обещает ту же самую бронь', async () => {
    open(WHOLE_PLAN)

    await screen.findByText(/бронь целиком переедет/)
    // No promise of a split, and no second row to explain afterwards.
    expect(screen.queryByText(/отдельной бронью/)).toBeNull()
  })

  it('называет, кто занимает номер, а не просто прячет его', async () => {
    open(SPLIT_PLAN)

    // "Куда можно поселить" and "почему нельзя в 106" are two questions, and
    // the second is the one that gets asked out loud.
    await screen.findByText('106')
    expect(screen.getByText(/занят: Пётр Ким/)).toBeTruthy()
    const taken = screen.getByText('106').closest('button')
    expect(taken?.hasAttribute('disabled')).toBe(true)
  })

  it('не даёт переселить, пока не выбран объект', async () => {
    open(SPLIT_PLAN)

    const confirm = await screen.findByRole('button', { name: 'Переселить' })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByText('105').closest('button')!)
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false))
  })

  it('подставляет цену выбранного номера по прайсу, но не трогает то, что вписал человек', async () => {
    open(SPLIT_PLAN)

    await userEvent.click((await screen.findByText('105')).closest('button')!)
    const price = screen.getByLabelText(/За «105»/) as HTMLInputElement
    await waitFor(() => expect(price.value).toBe('36000'))

    // Typed over: from here the figure belongs to whoever typed it, exactly as
    // in the booking form. Re-selecting the same room must not move it back.
    await userEvent.clear(price)
    await userEvent.type(price, '34000')
    await userEvent.click(screen.getByText('105').closest('button')!)
    expect(price.value).toBe('34000')
  })

  it('по умолчанию делит согласованную сумму, а не выставляет новую', async () => {
    const { posted } = open(SPLIT_PLAN)

    await userEvent.click((await screen.findByText('105')).closest('button')!)
    // The default the screen states: 20 000 + 30 000 = the 50 000 agreed.
    // Whitespace stripped: money() separates thousands with a non-breaking
    // space, which is right on screen and invisible in a string comparison.
    const split = screen.getByText(/делятся по ночам/).textContent!.replace(/\s/g, '')
    expect(split).toContain('20000')
    expect(split).toContain('30000')

    await userEvent.click(screen.getByRole('button', { name: 'Переселить' }))
    await waitFor(() => expect(posted.length).toBe(1))
    expect(posted[0].to_unit_id).toBe(5)
    expect(posted[0].stay_amount).toBe(20000)
  })

  it('после переселения говорит, что деньги ушли за гостем', async () => {
    const { onSaved } = open(SPLIT_PLAN)

    await userEvent.click((await screen.findByText('105')).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Переселить' }))

    await screen.findByText('Гость переселён')
    expect(
      screen.getByText(/предоплаты перенесено на новую/).textContent!.replace(/\s/g, '')
    ).toContain('30000')
    // The room they left has to be cleaned, and nobody should have to guess.
    expect(screen.getByText(/«101» отправлен на уборку/)).toBeTruthy()
    expect(onSaved).toHaveBeenCalled()
  })

  it('не прячет долг, оставшийся за прожитыми ночами', async () => {
    // A guest who had not paid up front leaves a balance on the leg that
    // closed. Carrying it forward would mean inventing a payment on that leg,
    // so it stays where it was incurred — and the screen has to say so, or the
    // debt is simply lost from view.
    open(
      SPLIT_PLAN,
      transferResult({
        carried_amount: 0,
        previous: { ...BOOKING, status: 'free', total_amount: 20000, prepaid_amount: 0, remaining_amount: 20000 },
        booking: { ...BOOKING, id: 13, unit_id: 5, total_amount: 30000, prepaid_amount: 0, remaining_amount: 30000 },
      })
    )

    await userEvent.click((await screen.findByText('105')).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Переселить' }))

    await screen.findByText('Гость переселён')
    expect(screen.getByText(/числится за бронью #12/)).toBeTruthy()
    expect(screen.queryByText(/предоплаты перенесено/)).toBeNull()
  })

  it('для целого переезда не обещает второй брони', async () => {
    open(
      WHOLE_PLAN,
      transferResult({ mode: 'whole', split_on: null, carried_amount: undefined, previous: null })
    )

    await userEvent.click((await screen.findByText('105')).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Переселить' }))

    await screen.findByText('Гость переселён')
    expect(screen.getByText(/тот же номер брони/)).toBeTruthy()
    expect(screen.queryByText(/отправлен на уборку/)).toBeNull()
  })
})

describe('§38 переселение читается в журнале и в причине завершения', () => {
  it('называет оба номера, а не только тот, где гость оказался', () => {
    const entry = {
      id: 1, staff_user_id: 1, staff_name: 'Нурлан', staff_role: 'admin',
      action: 'booking.transfer:101→105', entity: 'bookings', entity_id: 13,
      created_at: '2026-08-11 10:00', target: 'Номер 105', guest_name: 'Иван Камранов',
    } as AuditEntry
    // The booking's own unit column already says where the guest ended up;
    // nothing else in the schema remembers where they came from.
    expect(describeAudit(entry)).toBe('Переселение 101→105')
  })

  it('«Переселение» читается словом, но выбрать его как причину нельзя', () => {
    expect(REASON_LABELS.transferred).toBe('Переселение')
    // A leg of a move is closed by moving the guest and by nothing else — a
    // «Переселение» option in the booking form would be a way to end a stay
    // without anything having moved.
    expect(CANCEL_REASONS).not.toContain('transferred')
  })
})
