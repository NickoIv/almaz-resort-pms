import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeUnit, mockApi, renderApp, signIn, STAFF, useCardView } from './test-utils'
import type { Booking } from './types'

const ROOM_WITH_GUEST = makeUnit({
  id: 5,
  name: '105',
  status: 'occupied',
  needs_cleaning: true,
  cleaning_pending: 3,
  cleaning_total: 8,
  current_booking: {
    id: 42,
    guest_name: 'Асель Жумабаева',
    guest_phone: '+7 707 314 88 20',
    date_from: '2026-08-07',
    date_to: '2026-08-10',
    status: 'occupied',
    is_paid: false,
    total_amount: 240000,
    prepaid_amount: 120000,
    deposit_amount: 50000,
    charges_amount: 50000,
    remaining_amount: 170000,
    currency: 'KZT',
  },
})

const GAZEBO = makeUnit({
  id: 20,
  type: 'gazebo',
  name: 'Беседка 1',
  status: 'occupied',
  current_booking: {
    id: 77,
    guest_name: 'Динара Касымова',
    guest_phone: '+77012223344',
    date_from: '2026-08-08 13:00',
    date_to: '2026-08-08 18:00',
    status: 'occupied',
    is_paid: false,
    total_amount: 45000,
    prepaid_amount: 0,
    deposit_amount: 0,
    charges_amount: 0,
    remaining_amount: 45000,
    currency: 'KZT',
  },
})

const CALENDAR = {
  unit: { id: 5, name: '105', type: 'room' },
  month: '2026-08',
  days: Array.from({ length: 31 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    status: i >= 6 && i <= 9 ? 'occupied' : 'free',
    booking_id: i >= 6 && i <= 9 ? 42 : null,
    guest_name: i >= 6 && i <= 9 ? 'Асель Жумабаева' : null,
  })),
  bookings: [],
}

const CHECKLIST = [
  { id: 1, unit_id: 5, booking_id: 42, item_name: 'Смена постельного белья', is_done: false,
    updated_at: null, updated_by: null, updated_by_name: null },
  { id: 2, unit_id: 5, booking_id: 42, item_name: 'Уборка санузла', is_done: true,
    updated_at: '2026-08-08 09:00', updated_by: 2, updated_by_name: 'Айгуль Сериккызы' },
]

function baseRoutes(role: 'admin' | 'housekeeper' | 'waiter', units = [ROOM_WITH_GUEST]) {
  return {
    'GET /api/auth/me': { user: STAFF[role] },
    'GET /api/units': units,
    'GET /api/cleaning': { sla_minutes: 60, units: [] },
    'GET /api/cleaning/unit/': CHECKLIST,
    'GET /api/settings': { notifications: {}, telegram_configured: false },
    'GET /api/analytics/summary': {},
  }
}

describe('§1 clicking a card opens the detail view', () => {
  it('opens the room detail view when a room card is clicked', async () => {
    signIn('admin')
    useCardView()
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/units/5': ROOM_WITH_GUEST,
      'GET /api/units/5/calendar': CALENDAR,
      'GET /api/bookings/42/payments': [],
      'GET /api/bookings/42/charges': [],
    })

    renderApp(<App />, { route: '/rooms' })

    const card = await screen.findByRole('button', { name: /105/ })
    await userEvent.click(card)

    // The detail view is identified by its own heading, not by the card text.
    expect(await screen.findByRole('heading', { name: /Номер 105/ })).toBeInTheDocument()
  })

  it('shows the calendar, guest info and cleaning checklist in the detail view', async () => {
    signIn('admin')
    useCardView()
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/units/5': ROOM_WITH_GUEST,
      'GET /api/units/5/calendar': CALENDAR,
      'GET /api/bookings/42/payments': [],
      'GET /api/bookings/42/charges': [],
    })

    renderApp(<App />, { route: '/rooms/5' })

    expect(await screen.findByRole('heading', { name: /Номер 105/ })).toBeInTheDocument()
    // Guest info
    expect(screen.getByText('Асель Жумабаева')).toBeInTheDocument()
    expect(screen.getByText('+7 707 314 88 20')).toBeInTheDocument()
    expect(screen.getByText('2026-08-07')).toBeInTheDocument()
    expect(screen.getByText('2026-08-10')).toBeInTheDocument()
    // Cleaning checklist
    expect(screen.getByText('Смена постельного белья')).toBeInTheDocument()
    // Calendar rendered a full month
    await waitFor(() => expect(screen.getByText('31')).toBeInTheDocument())
  })

  it('opens a detail view for a restaurant unit too', async () => {
    signIn('admin')
    useCardView()
    mockApi({
      ...baseRoutes('admin', [GAZEBO]),
      'GET /api/units/20': GAZEBO,
      'GET /api/units/20/calendar': { ...CALENDAR, unit: { id: 20, name: 'Беседка 1', type: 'gazebo' } },
      'GET /api/bookings/77/payments': [],
      'GET /api/bookings/77/charges': [],
    })

    renderApp(<App />, { route: '/restaurant' })

    // The page opens on the Топчаны tab; gazebos live under their own tab.
    await userEvent.click(await screen.findByRole('button', { name: /^Беседки/ }))

    const card = await screen.findByRole('button', { name: /Беседка 1/ })
    await userEvent.click(card)

    expect(await screen.findByRole('heading', { name: /Беседка 1/ })).toBeInTheDocument()
    expect(screen.getByText('Динара Касымова')).toBeInTheDocument()
  })
})

describe('§1/§2 payment breakdown keeps deposit separate', () => {
  it('shows rate, charges, balance and deposit as distinct values', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/units/5': ROOM_WITH_GUEST,
      'GET /api/units/5/calendar': CALENDAR,
      'GET /api/bookings/42/payments': [],
      'GET /api/bookings/42/charges': [
        { id: 1, booking_id: 42, reason: 'Поздний выезд', amount: 18000,
          created_at: '2026-08-08', created_by_name: 'Нурлан Абдразаков' },
        { id: 2, booking_id: 42, reason: 'Испорченное имущество', amount: 32000,
          created_at: '2026-08-08', created_by_name: 'Нурлан Абдразаков' },
      ],
    })

    renderApp(<App />, { route: '/rooms/5' })

    expect(await screen.findByRole('heading', { name: /Номер 105/ })).toBeInTheDocument()

    // Charges appear as their own line items, not folded into the rate.
    expect(screen.getByText(/Поздний выезд/)).toBeInTheDocument()
    expect(screen.getByText(/Испорченное имущество/)).toBeInTheDocument()

    // The deposit is labelled as refundable and sits outside the balance.
    expect(screen.getByText('Депозит / залог')).toBeInTheDocument()
    expect(screen.getByText(/не входит в остаток/)).toBeInTheDocument()

    // Balance (170 000) and deposit (50 000) are distinct numbers on screen.
    // Intl picks a non-breaking space whose exact codepoint varies by ICU
    // version, so compare with whitespace normalised.
    const byMoney = (amount: string) =>
      screen.getByText(
        (_, el) => el?.textContent?.replace(/\s+/g, ' ').trim() === `${amount} ₸`
      )

    expect(byMoney('170 000')).toBeInTheDocument()
    expect(byMoney('50 000')).toBeInTheDocument()
  })
})

describe('§2 guest names render in full', () => {
  it('renders a full Cyrillic name without truncation or escaping', async () => {
    signIn('admin')
    useCardView()
    mockApi(baseRoutes('admin'))
    renderApp(<App />, { route: '/rooms' })
    expect(await screen.findByText('Асель Жумабаева')).toBeInTheDocument()
  })

  it('renders names containing backslashes and angle brackets verbatim', async () => {
    signIn('admin')
    useCardView()
    const tricky = makeUnit({
      id: 9,
      name: '109',
      status: 'occupied',
      current_booking: {
        id: 1, guest_name: 'Ван\\ <Ли> & Со', guest_phone: null,
        date_from: '2026-08-07', date_to: '2026-08-09', status: 'occupied', is_paid: true,
      },
    })
    mockApi(baseRoutes('admin', [tricky]))
    renderApp(<App />, { route: '/rooms' })
    expect(await screen.findByText('Ван\\ <Ли> & Со')).toBeInTheDocument()
  })
})

describe('§7 role-restricted views', () => {
  it('sends a housekeeper to cleaning and keeps money off the screen', async () => {
    signIn('housekeeper')
    mockApi({
      ...baseRoutes('housekeeper'),
      'GET /api/cleaning': {
        sla_minutes: 60,
        units: [{ id: 5, type: 'room', name: '105', category: 'standard', total: 8, pending: 3,
                  waiting_since: '2026-08-08 09:00', waiting_minutes: 20, is_overdue: false }],
      },
      'GET /api/cleaning/unit/5': CHECKLIST,
    })

    renderApp(<App />, { route: '/rooms' })

    // Guarded away from the rooms dashboard, landed on cleaning.
    expect(await screen.findByRole('heading', { name: 'Уборка' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Номера' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Аналитика/)).not.toBeInTheDocument()
    expect(screen.queryByText(/₸/)).not.toBeInTheDocument()
  })

  it('sends a waiter to the restaurant and hides rooms and analytics', async () => {
    signIn('waiter')
    mockApi(baseRoutes('waiter', [GAZEBO]))

    renderApp(<App />, { route: '/analytics' })

    expect(await screen.findByRole('heading', { name: 'Зона отдыха' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Аналитика' })).not.toBeInTheDocument()
    expect(screen.queryByText('Номера')).not.toBeInTheDocument()
  })

  it('shows the admin every section in the nav', async () => {
    signIn('admin')
    mockApi(baseRoutes('admin'))
    renderApp(<App />, { route: '/rooms' })

    expect(await screen.findByRole('link', { name: 'Номера' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Аналитика' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Настройки' })).toBeInTheDocument()
  })
})

describe('§5 search and filter', () => {
  const rooms = [
    ROOM_WITH_GUEST,
    makeUnit({ id: 6, name: '106', status: 'free' }),
    makeUnit({
      id: 7, name: '107', status: 'booked',
      current_booking: {
        id: 8, guest_name: 'Тимур Оспанов', guest_phone: '+77019995544',
        date_from: '2026-08-20', date_to: '2026-08-23', status: 'booked', is_paid: true,
      },
    }),
  ]

  it('filters by guest name', async () => {
    signIn('admin')
    useCardView()
    mockApi(baseRoutes('admin', rooms))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /105/ })
    await userEvent.type(screen.getByRole('searchbox'), 'Тимур')

    expect(screen.getByRole('button', { name: /107/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /105/ })).not.toBeInTheDocument()
  })

  it('filters by phone typed without punctuation', async () => {
    signIn('admin')
    useCardView()
    mockApi(baseRoutes('admin', rooms))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /105/ })
    await userEvent.type(screen.getByRole('searchbox'), '77073148820')

    expect(screen.getByRole('button', { name: /105/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /107/ })).not.toBeInTheDocument()
  })

  it('filters by status', async () => {
    signIn('admin')
    useCardView()
    mockApi(baseRoutes('admin', rooms))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /105/ })
    await userEvent.click(screen.getByRole('button', { name: /^Свободен/ }))

    expect(screen.getByRole('button', { name: /106/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /105/ })).not.toBeInTheDocument()
  })
})
describe('currency selector', () => {
  const freeRoom = makeUnit({ id: 6, name: '106', status: 'free' })

  it('offers KZT, USD and CNY in the booking form, defaulting to KZT', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin', [freeRoom]),
      'GET /api/units/6': freeRoom,
      'GET /api/units/6/calendar': CALENDAR,
    })

    renderApp(<App />, { route: '/rooms/6' })
    await userEvent.click(await screen.findByRole('button', { name: 'Новая бронь' }))

    const select = await screen.findByLabelText('Валюта')
    expect(select).toHaveValue('KZT')
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      'KZT', 'USD', 'CNY',
    ])
  })

  it('sends the chosen currency when creating a booking', async () => {
    signIn('admin')
    let posted: Record<string, unknown> | null = null
    mockApi({
      ...baseRoutes('admin', [freeRoom]),
      'GET /api/units/6': freeRoom,
      'GET /api/units/6/calendar': CALENDAR,
      'POST /api/bookings': (_url: string, init?: RequestInit) => {
        posted = JSON.parse(String(init?.body))
        return { id: 1 }
      },
    })

    renderApp(<App />, { route: '/rooms/6' })
    await userEvent.click(await screen.findByRole('button', { name: 'Новая бронь' }))
    await userEvent.type(screen.getByLabelText('Гость'), 'Ли Вэй')
    await userEvent.selectOptions(screen.getByLabelText('Валюта'), 'CNY')
    await userEvent.type(screen.getByLabelText('Сумма'), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted!.currency).toBe('CNY')
    expect(posted!.total_amount).toBe(5000)
  })

  it('sends the chosen currency from the waiter quick-book form', async () => {
    signIn('waiter')
    const gazebo = makeUnit({ id: 20, type: 'gazebo', name: 'Беседка 1', status: 'free' })
    let posted: Record<string, unknown> | null = null
    mockApi({
      ...baseRoutes('waiter', [gazebo]),
      'POST /api/bookings/quick': (_url: string, init?: RequestInit) => {
        posted = JSON.parse(String(init?.body))
        return { id: 2 }
      },
    })

    renderApp(<App />, { route: '/restaurant' })
    await userEvent.click(await screen.findByRole('button', { name: /^Беседки/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Занять сейчас' }))
    await userEvent.type(screen.getByLabelText('Гость'), 'Ван Ли')
    await userEvent.selectOptions(screen.getByLabelText('Валюта'), 'USD')
    await userEvent.click(screen.getByRole('button', { name: /Занять на/ }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted!.currency).toBe('USD')
  })
})

describe('Almaty time in the UI', () => {
  // 18:30 UTC = 23:30 in Almaty (8 Aug), but 01:30 on 9 Aug for a UTC+7
  // device. Everything below must follow Almaty, not the device.
  const AT = new Date('2026-08-08T18:30:00Z')

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true, now: AT }))
  afterEach(() => vi.useRealTimers())

  const freeRoom = makeUnit({ id: 6, name: '106', status: 'free' })
  const augustCalendar = {
    unit: { id: 6, name: '106', type: 'room' },
    month: '2026-08',
    days: Array.from({ length: 31 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      status: 'free', booking_id: null, guest_name: null,
    })),
    bookings: [],
  }

  it('shows the hotel clock in the header', async () => {
    signIn('admin')
    mockApi(baseRoutes('admin', [freeRoom]))
    renderApp(<App />, { route: '/rooms' })

    expect(await screen.findByText('23:30')).toBeInTheDocument()
    expect(screen.getByText('Алматы')).toBeInTheDocument()
    // 01:30 would be the UTC+7 device time — it must not appear.
    expect(screen.queryByText('01:30')).not.toBeInTheDocument()
  })

  it('highlights the hotel "today" in the calendar, not the device day', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin', [freeRoom]),
      'GET /api/units/6': freeRoom,
      'GET /api/units/6/calendar': augustCalendar,
    })

    renderApp(<App />, { route: '/rooms/6' })
    await screen.findByRole('heading', { name: /Номер 106/ })

    const today = document.querySelector('.cal-day.is-today')
    expect(today).not.toBeNull()
    expect(today!.textContent).toBe('8')
  })

  it('defaults a new booking to the hotel date, and checkout to the next day', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin', [freeRoom]),
      'GET /api/units/6': freeRoom,
      'GET /api/units/6/calendar': augustCalendar,
    })

    renderApp(<App />, { route: '/rooms/6' })
    await userEvent.click(await screen.findByRole('button', { name: 'Новая бронь' }))

    expect(await screen.findByLabelText('Заезд')).toHaveValue('2026-08-08')
    expect(screen.getByLabelText('Выезд')).toHaveValue('2026-08-09')
  })
})

describe('staff management page', () => {
  const STAFF_LIST = [
    { id: 1, name: 'Нурлан Абдразаков', phone: '+77011112233', role: 'admin', is_active: true },
    { id: 2, name: 'Айгуль Сериккызы', phone: '+77022223344', role: 'housekeeper', is_active: true },
    { id: 3, name: 'Ержан Тулеуов', phone: '+77033334455', role: 'waiter', is_active: false },
  ]

  it('lists staff grouped by role with their active state', async () => {
    signIn('admin')
    mockApi({ ...baseRoutes('admin'), 'GET /api/staff': STAFF_LIST })
    renderApp(<App />, { route: '/staff' })

    expect(await screen.findByRole('heading', { name: 'Персонал' })).toBeInTheDocument()

    // Wait for the list itself — the heading renders while it is still loading.
    expect(await screen.findByText('+77022223344')).toBeInTheDocument()
    // The admin's name also appears in the header, hence getAllByText.
    expect(screen.getAllByText('Нурлан Абдразаков').length).toBeGreaterThan(0)
    // The disabled waiter is still listed, flagged rather than hidden.
    expect(screen.getByText('Ержан Тулеуов')).toBeInTheDocument()
    expect(screen.getByText('отключён')).toBeInTheDocument()
  })

  it('never renders a PIN or hash', async () => {
    signIn('admin')
    mockApi({ ...baseRoutes('admin'), 'GET /api/staff': STAFF_LIST })
    renderApp(<App />, { route: '/staff' })
    await screen.findByText('+77022223344')

    expect(document.body.textContent).not.toMatch(/pbkdf2|1234|2345|3456/)
  })

  it('will not let an admin disable their own account', async () => {
    signIn('admin') // STAFF.admin.id === 1
    mockApi({ ...baseRoutes('admin'), 'GET /api/staff': STAFF_LIST })
    renderApp(<App />, { route: '/staff' })
    await screen.findByText('+77011112233')

    const selfRow = screen.getByText('это вы').closest('.row-card')!
    const disableButton = within(selfRow as HTMLElement).getByRole('button', { name: 'Отключить' })
    expect(disableButton).toBeDisabled()
  })

  it('creates a staff member through the form', async () => {
    signIn('admin')
    let posted: Record<string, unknown> | null = null
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/staff': STAFF_LIST,
      'POST /api/staff': (_url: string, init?: RequestInit) => {
        posted = JSON.parse(String(init?.body))
        return { id: 9 }
      },
    })
    renderApp(<App />, { route: '/staff' })

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить сотрудника' }))
    await userEvent.type(screen.getByLabelText('Имя'), 'Гульнара Ким')
    await userEvent.type(screen.getByLabelText('Телефон'), '+77005554030')
    await userEvent.selectOptions(screen.getByLabelText('Роль'), 'waiter')
    await userEvent.type(screen.getByLabelText('PIN'), '4821')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({
      name: 'Гульнара Ким',
      phone: '+77005554030',
      role: 'waiter',
      pin: '4821',
    })
  })

  it('keeps the staff page away from non-admins', async () => {
    signIn('waiter')
    mockApi(baseRoutes('waiter', [GAZEBO]))
    renderApp(<App />, { route: '/staff' })

    expect(await screen.findByRole('heading', { name: 'Зона отдыха' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Персонал' })).not.toBeInTheDocument()
  })
})

describe('§2 cleaning SLA', () => {
  it('shows elapsed time and flags a unit past the threshold', async () => {
    signIn('housekeeper')
    mockApi({
      ...baseRoutes('housekeeper'),
      'GET /api/cleaning': {
        sla_minutes: 60,
        units: [
          { id: 5, type: 'room', name: '105', category: 'standard', total: 8, pending: 3,
            waiting_since: '2026-08-08 07:00', waiting_minutes: 95, is_overdue: true },
          { id: 6, type: 'room', name: '106', category: 'standard', total: 8, pending: 1,
            waiting_since: '2026-08-08 09:40', waiting_minutes: 12, is_overdue: false },
        ],
      },
      'GET /api/cleaning/unit/5': CHECKLIST,
    })

    renderApp(<App />, { route: '/cleaning' })
    await screen.findByRole('heading', { name: 'Уборка' })

    // 95 minutes reads as hours and minutes, 12 stays in minutes.
    expect(await screen.findByText(/ждёт 1 ч 35 мин/)).toBeInTheDocument()
    expect(screen.getByText(/ждёт 12 мин/)).toBeInTheDocument()

    // The overdue one is marked structurally, not by colour alone.
    // Scope to the card's own name element — the selected unit's name also
    // appears in the checklist panel title.
    const cardNamed = (name: string) =>
      [...document.querySelectorAll('.unit-card')].find(
        (card) => card.querySelector('.unit-name')?.textContent === name
      )!
    expect(cardNamed('105')).toHaveClass('is-overdue')
    expect(cardNamed('106')).not.toHaveClass('is-overdue')

    // And the header counts them using the threshold the API supplied.
    expect(screen.getByText(/1 дольше 60 мин/)).toBeInTheDocument()
  })
})

describe('§3 housekeeping shift sheet', () => {
  const OVERVIEW = {
    sla_minutes: 60,
    units: [{ id: 5, type: 'room', name: '105', category: 'standard', total: 3, pending: 2,
              waiting_since: '2026-08-08 09:00', waiting_minutes: 20, is_overdue: false }],
  }
  const SHEET = {
    generated_at: '2026-08-08 10:30',
    units: [
      { id: 5, name: '105', type: 'room', category: 'standard', waiting_since: '2026-08-08 09:00',
        items: [
          { id: 1, item_name: 'Смена постельного белья', is_done: false },
          { id: 2, item_name: 'Уборка санузла', is_done: true },
        ] },
      { id: 6, name: '106', type: 'room', category: 'comfort', waiting_since: '2026-08-08 09:30',
        items: [{ id: 3, item_name: 'Пылесос и полы', is_done: false }] },
    ],
  }

  it('renders every unit and its checklist on the printable sheet', async () => {
    signIn('housekeeper')
    mockApi({
      ...baseRoutes('housekeeper'),
      'GET /api/cleaning': OVERVIEW,
      'GET /api/cleaning/sheet': SHEET,
      'GET /api/cleaning/unit/5': CHECKLIST,
    })

    renderApp(<App />, { route: '/cleaning' })
    await userEvent.click(await screen.findByRole('button', { name: 'Печать заданий на смену' }))

    expect(await screen.findByText('Задания на смену — уборка')).toBeInTheDocument()
    expect(screen.getByText(/объектов: 2/)).toBeInTheDocument()

    const sheet = document.querySelector('.print-sheet')!
    expect(within(sheet as HTMLElement).getByText('Смена постельного белья')).toBeInTheDocument()
    expect(within(sheet as HTMLElement).getByText('Пылесос и полы')).toBeInTheDocument()

    // Already-done items stay visible but struck through, so a partly cleaned
    // unit is not started from scratch.
    const doneItem = within(sheet as HTMLElement).getByText('Уборка санузла').closest('li')!
    expect(doneItem).toHaveClass('is-done')

    // Each unit gets a signature line.
    expect(sheet.querySelectorAll('.sheet-sign')).toHaveLength(2)
  })

  it('is offered only when something needs cleaning', async () => {
    signIn('housekeeper')
    mockApi({ ...baseRoutes('housekeeper'), 'GET /api/cleaning': { sla_minutes: 60, units: [] } })
    renderApp(<App />, { route: '/cleaning' })

    await screen.findByRole('heading', { name: 'Уборка' })
    expect(screen.getByRole('button', { name: 'Печать заданий на смену' })).toBeDisabled()
  })
})

describe('§4 the invoice', () => {
  const BOOKED_ROOM = makeUnit({
    id: 5, name: '105', status: 'occupied',
    current_booking: {
      id: 42, guest_name: 'Асель Жумабаева', guest_phone: '+7 707 314 88 20',
      date_from: '2026-08-07', date_to: '2026-08-10', status: 'occupied', is_paid: false,
      total_amount: 240000, prepaid_amount: 120000, deposit_amount: 50000,
      charges_amount: 50000, remaining_amount: 170000, currency: 'KZT',
    },
  })
  const CHARGES = [
    { id: 1, booking_id: 42, reason: 'Поздний выезд', amount: 18000,
      created_at: '2026-08-08', created_by_name: 'Нурлан' },
    { id: 2, booking_id: 42, reason: 'Испорченное имущество', amount: 32000,
      created_at: '2026-08-08', created_by_name: 'Нурлан' },
  ]

  function routes() {
    return {
      ...baseRoutes('admin', [BOOKED_ROOM]),
      'GET /api/units/5': BOOKED_ROOM,
      'GET /api/units/5/calendar': CALENDAR,
      'GET /api/bookings/42/payments': [
        { id: 1, booking_id: 42, amount: 120000, method: 'kaspi',
          paid_at: '2026-08-07 12:00', group_id: null },
      ],
      'GET /api/bookings/42/charges': CHARGES,
      'GET /api/settings': {
        notifications: {}, channel: 'whatsapp', whatsapp_configured: false,
        telegram_configured: false,
        text: { hotel_name: 'Taura', hotel_details: 'Алматы, ул. Пример 1' },
      },
    }
  }

  it('itemises the rate, each charge, totals, and keeps the deposit separate', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/5' })

    await userEvent.click(await screen.findByRole('button', { name: 'Печать инвойса' }))
    const heading = await screen.findByText('Инвойс')
    const sheet = heading.closest('.print-sheet')!
    const q = within(sheet as HTMLElement)

    // Numbered and dated, which is what makes it an invoice rather than a till
    // receipt. The number comes from the booking, so a reprint matches.
    expect(q.getByText('№ 2026-00042')).toBeInTheDocument()

    // Hotel identity comes from settings, not a hard-coded string.
    expect(q.getByText('Taura')).toBeInTheDocument()
    expect(q.getByText('Алматы, ул. Пример 1')).toBeInTheDocument()

    // Guest and stay.
    expect(q.getByText('Асель Жумабаева')).toBeInTheDocument()
    expect(q.getByText('+7 707 314 88 20')).toBeInTheDocument()

    // Line items: rate plus each charge by its reason.
    expect(q.getByText(/Проживание/)).toBeInTheDocument()
    expect(q.getByText(/Поздний выезд/)).toBeInTheDocument()
    expect(q.getByText(/Испорченное имущество/)).toBeInTheDocument()

    // Totals: 240000 + 18000 + 32000 = 290000 billed, 120000 paid, 170000 due.
    const cash = (amount: string) =>
      q.getByText((_, el) => el?.textContent?.replace(/\s+/g, ' ').trim() === `${amount} ₸`)
    expect(cash('290 000')).toBeInTheDocument()
    expect(cash('170 000')).toBeInTheDocument()

    // The deposit is called out as refundable and sits outside the totals table.
    const depositNote = sheet.querySelector('.receipt-deposit')!
    expect(depositNote.textContent).toMatch(/возвратный, не входит в сумму/)
    // Intl uses a non-breaking space; normalise before matching.
    expect(depositNote.textContent?.replace(/\s+/g, ' ')).toMatch(/50 000 ₸/)
  })

  it('is offered only when there is an active booking', async () => {
    signIn('admin')
    const emptyRoom = makeUnit({ id: 6, name: '106', status: 'free' })
    mockApi({
      ...baseRoutes('admin', [emptyRoom]),
      'GET /api/units/6': emptyRoom,
      'GET /api/units/6/calendar': CALENDAR,
    })
    renderApp(<App />, { route: '/rooms/6' })

    await screen.findByRole('heading', { name: /Номер 106/ })
    expect(screen.queryByRole('button', { name: 'Печать инвойса' })).not.toBeInTheDocument()
  })
})

describe('§10 review profile links', () => {
  const withUrls = (urls: Partial<Record<string, string>>) => ({
    notifications: {}, channel: 'whatsapp', whatsapp_configured: false, telegram_configured: false,
    text: {
      hotel_name: 'Taura', hotel_details: '',
      reviews_2gis_url: '', reviews_google_url: '', ...urls,
    },
  })

  it('shows a link for each configured profile', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/settings': withUrls({
        reviews_2gis_url: 'https://2gis.kz/almaty/firm/123',
        reviews_google_url: 'https://g.page/taura',
      }),
    })
    renderApp(<App />, { route: '/rooms' })

    expect(await screen.findByText('Отзывы')).toBeInTheDocument()
    const twoGis = screen.getByRole('link', { name: '2ГИС' })
    expect(twoGis).toHaveAttribute('href', 'https://2gis.kz/almaty/firm/123')
    // Opened without leaking the PMS URL to the review site.
    expect(twoGis).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(screen.getByRole('link', { name: 'Google' })).toHaveAttribute('href', 'https://g.page/taura')
  })

  it('shows only the profile that is configured', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/settings': withUrls({ reviews_2gis_url: 'https://2gis.kz/almaty/firm/123' }),
    })
    renderApp(<App />, { route: '/rooms' })

    expect(await screen.findByRole('link', { name: '2ГИС' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Google' })).not.toBeInTheDocument()
  })

  it('stays hidden when neither is set', async () => {
    signIn('admin')
    mockApi({ ...baseRoutes('admin'), 'GET /api/settings': withUrls({}) })
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('heading', { name: 'Номера' })
    expect(screen.queryByText('Отзывы')).not.toBeInTheDocument()
  })
})

describe('§11 grouped navigation and the dashboard', () => {
  const DASH_ROUTES = {
    'GET /api/auth/me': { user: STAFF.admin },
    'GET /api/units': [ROOM_WITH_GUEST, GAZEBO],
    'GET /api/cleaning': {
      sla_minutes: 60,
      units: [
        { id: 5, type: 'room', name: '105', category: 'standard', total: 8, pending: 3,
          waiting_since: '2026-08-08 09:00', waiting_minutes: 95, is_overdue: true },
      ],
    },
    'GET /api/waitlist/summary': { open: 3 },
    'GET /api/audit': {
      total: 1, limit: 6, offset: 0,
      entries: [
        { id: 9, staff_user_id: 1, staff_name: 'Нурлан Абдразаков', staff_role: 'admin',
          action: 'booking.update:free:no_payment', entity: 'bookings', entity_id: 42,
          created_at: '2026-08-08 18:20', target: '105', guest_name: 'Асель Жумабаева' },
      ],
    },
    'GET /api/settings': { notifications: {}, telegram_configured: false },
    'GET /api/settings/preview': {
      empty: false,
      sections: 2,
      text: 'Taura PMS · сводка на 2026-08-09 — Выезды сегодня (1): 105, Асель',
    },
  }

  it('groups the nav under Работа, Отчёты and Управление for an admin', async () => {
    signIn('admin')
    mockApi(DASH_ROUTES)
    renderApp(<App />, { route: '/' })

    const nav = await screen.findByRole('navigation', { name: 'Разделы' })
    expect(within(nav).getByText('Работа')).toBeInTheDocument()
    expect(within(nav).getByText('Отчёты')).toBeInTheDocument()
    expect(within(nav).getByText('Управление')).toBeInTheDocument()

    // Every link stays reachable — grouping is not hiding.
    for (const label of ['Номера', 'Зона отдыха', 'Уборка', 'Ожидание',
                         'Аналитика', 'Журнал', 'Уведомления', 'Персонал', 'Настройки']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('drops a group whose every item the role cannot see', async () => {
    signIn('housekeeper')
    mockApi(baseRoutes('housekeeper'))
    renderApp(<App />, { route: '/cleaning' })

    const nav = await screen.findByRole('navigation', { name: 'Разделы' })
    expect(within(nav).getByText('Работа')).toBeInTheDocument()
    // Every report is admin-only, so that heading disappears entirely.
    expect(within(nav).queryByText('Отчёты')).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Уборка' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Номера' })).not.toBeInTheDocument()

    // «Управление» survives on one item: notifications are switched on per
    // person, so every role reaches them, while Персонал and Настройки do not.
    expect(within(nav).getByText('Управление')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Уведомления' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Персонал' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Настройки' })).not.toBeInTheDocument()
  })

  // The roll-up is a real rAF animation, and rAF gets starved when the whole
  // suite is competing for the machine. A generous ceiling here is not
  // papering over anything: the assertion is about where the number lands.
  it('lands the admin on a dashboard of summary tiles', { timeout: 20_000 }, async () => {
    signIn('admin')
    mockApi(DASH_ROUTES)
    renderApp(<App />, { route: '/' })

    expect(await screen.findByRole('heading', { name: 'Сводка' })).toBeInTheDocument()

    // One of two units is an occupied room; the gazebo is not counted as a room.
    // The headline figures roll up from zero, so this waits for the settled
    // value — which also proves the animation lands on the right number.
    const occupancy = screen.getByText('Занято номеров').closest('.tile')!
    await waitFor(() =>
      expect(within(occupancy as HTMLElement).getByText('1')).toBeInTheDocument(),
      { timeout: 10_000 }
    )
    expect(within(occupancy as HTMLElement).getByText(/из 1/)).toBeInTheDocument()

    const waitlist = screen.getByText('Лист ожидания').closest('.tile')!
    await waitFor(() =>
      expect(within(waitlist as HTMLElement).getByText('3')).toBeInTheDocument(),
      { timeout: 10_000 }
    )

    // The SLA breach is surfaced, not just the count of dirty units.
    expect(screen.getByText(/дольше 60 мин/)).toBeInTheDocument()

    // Recent activity reuses the log's wording for the same action code.
    expect(screen.getByText(/Изменена бронь — выезд \/ отмена/)).toBeInTheDocument()
  })

  it('links every tile to the page that can act on it', async () => {
    signIn('admin')
    mockApi(DASH_ROUTES)
    renderApp(<App />, { route: '/' })

    await screen.findByRole('heading', { name: 'Сводка' })
    const tiles = [...document.querySelectorAll('.tile')]
    // «Заезды сегодня» led to the board until «Сегодня» existed, where three
    // arrivals had to be found by reading down a column of fourteen rooms. A
    // tile that can act on its own number now leads to the list, not the chart.
    expect(tiles.map((tile) => tile.getAttribute('href'))).toEqual([
      '/rooms', '/cleaning', '/today', '/waitlist',
    ])
  })

  it('keeps a housekeeper out of the dashboard', async () => {
    signIn('housekeeper')
    mockApi(baseRoutes('housekeeper'))
    renderApp(<App />, { route: '/' })

    // Bounced to the one page they work in, not shown an empty summary.
    expect(await screen.findByRole('heading', { name: 'Уборка' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Сводка' })).not.toBeInTheDocument()
  })

  it('shows the outgoing digest here rather than under Settings', async () => {
    signIn('admin')
    mockApi(DASH_ROUTES)
    renderApp(<App />, { route: '/' })

    await screen.findByRole('heading', { name: 'Сводка' })
    expect(screen.getByText('Сводка для рассылки')).toBeInTheDocument()
    expect(screen.getByText(/Выезды сегодня/)).toBeInTheDocument()
  })

  it('leaves the digest preview off the settings page', async () => {
    signIn('admin')
    mockApi({
      ...DASH_ROUTES,
      'GET /api/settings': {
        notifications: { notify_checkins: true },
        channel: 'whatsapp',
        whatsapp_configured: false,
        telegram_configured: false,
        text: { hotel_name: 'Taura', hotel_details: '', reviews_2gis_url: '', reviews_google_url: '' },
      },
      'GET /api/backup/stored': { backups: [] },
    })
    renderApp(<App />, { route: '/settings' })

    await screen.findByRole('heading', { name: /Настройки|Уведомления/ })
    // The toggles stay; the operational preview does not.
    expect(screen.queryByText('Предпросмотр сводки')).not.toBeInTheDocument()
    expect(screen.queryByText('Сводка для рассылки')).not.toBeInTheDocument()
  })

  it('still renders the log when a tile endpoint fails', async () => {
    signIn('admin')
    mockApi({ ...DASH_ROUTES, 'GET /api/waitlist/summary': () => { throw new Error('down') } })
    renderApp(<App />, { route: '/' })

    // The waitlist tile degrades to zero rather than blanking the page.
    expect(await screen.findByRole('heading', { name: 'Сводка' })).toBeInTheDocument()
    expect(screen.getByText('Занято номеров')).toBeInTheDocument()
  })
})

describe('§12 the planning board', () => {
  const booking = (over = {}) => ({
    id: 42,
    guest_name: 'Асель Жумабаева',
    guest_phone: '+77073148820',
    status: 'occupied' as const,
    date_from: '2026-08-10',
    date_to: '2026-08-13',
    total_amount: 240000,
    prepaid_amount: 120000,
    deposit_amount: 50000,
    charges_amount: 0,
    remaining_amount: 120000,
    currency: 'KZT',
    ...over,
  })

  /** 101 is booked across three nights; 104 has nothing. */
  const TIMELINE = {
    from: '2026-08-09',
    days: 7,
    max_days: 30,
    dates: ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
            '2026-08-14', '2026-08-15'],
    rooms: [
      { unit_id: 5, unit_name: '101', category: 'standard', capacity: 2, bookings: [booking()] },
      { unit_id: 6, unit_name: '104', category: 'standard', capacity: 2, bookings: [] },
    ],
  }

  /** A year as the endpoint returns it: two rooms, twelve months each. */
  const YEAR = {
    year: 2026,
    rooms_total: 2,
    months: Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, '0')}`,
      nights_total: 30,
      nights_sold: index === 7 ? 44 : 0,
      nights_available: 60,
      occupancy_rate: index === 7 ? 44 / 60 : 0,
      rooms_free: index === 7 ? 0 : 2,
    })),
    rooms: [
      {
        unit_id: 5, unit_name: '101', category: 'standard', capacity: 2,
        months: Array.from({ length: 12 }, (_, index) => ({
          month: `2026-${String(index + 1).padStart(2, '0')}`,
          nights_sold: index === 7 ? 30 : 0,
          nights_total: 30,
        })),
      },
      {
        unit_id: 6, unit_name: '104', category: 'standard', capacity: 2,
        months: Array.from({ length: 12 }, (_, index) => ({
          month: `2026-${String(index + 1).padStart(2, '0')}`,
          nights_sold: index === 7 ? 14 : 0,
          nights_total: 30,
        })),
      },
    ],
  }

  function routesWithSpy(calls: string[], body: unknown = TIMELINE) {
    return {
      ...baseRoutes('admin'),
      'GET /api/rooms/timeline': (url: string) => {
        calls.push(url)
        return body
      },
      'GET /api/rooms/year': (url: string) => {
        calls.push(url)
        return YEAR
      },
    }
  }

  /** The board is the default view, so nothing needs clicking to reach it. */
  async function openBoard(calls: string[], body: unknown = TIMELINE) {
    signIn('admin')
    mockApi(routesWithSpy(calls, body))
    renderApp(<App />, { route: '/rooms' })
    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await waitFor(() => expect(document.querySelector('.tl-row')).toBeTruthy())
  }

  function rowFor(name: string): Element {
    return [...document.querySelectorAll('.tl-row')].find(
      (r) => r.querySelector('.tl-room')?.textContent === name
    )!
  }

  /** A press-and-release across a run of cells, as a pointer would do it. */
  function dragNights(cells: Element[]) {
    fireEvent.pointerDown(cells[0], { pointerType: 'mouse' })
    for (const cell of cells.slice(1)) fireEvent.pointerEnter(cell, { pointerType: 'mouse' })
    fireEvent.pointerUp(window)
  }

  it('opens on the board rather than the card grid', async () => {
    const calls: string[] = []
    await openBoard(calls)

    // Two rooms, plus the date header and the availability row.
    expect(document.querySelectorAll('.tl-row')).toHaveLength(4)
    expect(document.querySelectorAll('.tl-cell')).toHaveLength(14)
    expect(screen.getByRole('button', { name: '101' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '104' })).toBeInTheDocument()
  })

  it('counts free rooms per night in the columns of the board itself', async () => {
    const calls: string[] = []
    await openBoard(calls)

    const free = [...document.querySelectorAll('.tl-free')].map((n) => n.textContent)
    // 101 is taken on the nights of the 10th, 11th and 12th; 104 never is.
    expect(free).toEqual(['2', '1', '1', '1', '2', '2', '2'])
    // One room left reads as tight, and is marked as such.
    expect(document.querySelectorAll('.tl-free.is-low')).toHaveLength(3)
  })

  it('draws a multi-night stay as one continuous bar over its nights', async () => {
    const calls: string[] = []
    await openBoard(calls)

    const bar = document.querySelector('.tl-bar') as HTMLElement
    expect(bar.textContent).toContain('Асель Жумабаева')
    // 10 to 13 is three nights from the window's second day; column 1 is the
    // room name, so the bar begins at column 3.
    expect(bar.style.gridColumn).toBe('3 / span 3')
  })

  it('turns a dragged run of nights into a booking for that range', async () => {
    const calls: string[] = []
    await openBoard(calls)

    const cells = [...rowFor('104').querySelectorAll('.tl-cell')]
    dragNights(cells.slice(1, 4)) // nights of the 10th, 11th and 12th

    expect(await screen.findByRole('heading', { name: 'Новая бронь' })).toBeInTheDocument()
    const dates = [...document.querySelectorAll('.modal input[type=date]')] as HTMLInputElement[]
    expect(dates[0].value).toBe('2026-08-10')
    // Three nights means checkout on the morning of the 13th.
    expect(dates[1].value).toBe('2026-08-13')
  })

  it('books a single night from one press', async () => {
    const calls: string[] = []
    await openBoard(calls)

    dragNights([[...rowFor('104').querySelectorAll('.tl-cell')][0]])

    await screen.findByRole('heading', { name: 'Новая бронь' })
    const dates = [...document.querySelectorAll('.modal input[type=date]')] as HTMLInputElement[]
    expect(dates[0].value).toBe('2026-08-09')
    expect(dates[1].value).toBe('2026-08-10')
  })

  it('refuses a run that crosses an existing booking, and says which nights', async () => {
    const calls: string[] = []
    await openBoard(calls)

    const cells = [...rowFor('101').querySelectorAll('.tl-cell')]
    dragNights(cells.slice(0, 3)) // the 9th is free, the 10th and 11th are not

    // No form: the collision is caught before anyone types anything into one.
    expect(screen.queryByRole('heading', { name: 'Новая бронь' })).not.toBeInTheDocument()
    expect(await screen.findByText(/уже заняты/)).toBeInTheDocument()
  })

  it('opens a booking card from its bar, with the money already in hand', async () => {
    const calls: string[] = []
    await openBoard(calls)

    await userEvent.click(document.querySelector('.tl-bar') as HTMLElement)

    const card = await screen.findByRole('dialog', { name: 'Бронь' })
    expect(within(card).getByText('Асель Жумабаева')).toBeInTheDocument()
    expect(within(card).getByText(/120 000/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Изменить бронь' })).toBeInTheDocument()
  })

  it('edits straight from the board, without a trip to the room page', async () => {
    const calls: string[] = []
    await openBoard(calls)

    await userEvent.click(document.querySelector('.tl-bar') as HTMLElement)
    await userEvent.click(await screen.findByRole('button', { name: 'Изменить бронь' }))

    expect(await screen.findByRole('heading', { name: /Бронь #42/ })).toBeInTheDocument()
    const dates = [...document.querySelectorAll('.modal input[type=date]')] as HTMLInputElement[]
    expect(dates[0].value).toBe('2026-08-10')
    expect(dates[1].value).toBe('2026-08-13')
  })

  /** Days in a 1-based month, so the expectation is not a hard-coded 31. */
  const lengthOf = (month: string) => {
    const [y, m] = month.split('-').map(Number)
    return new Date(Date.UTC(y, m, 0)).getUTCDate()
  }

  it('asks for a whole calendar month, from the 1st, not a rolling thirty days', async () => {
    const calls: string[] = []
    await openBoard(calls)

    expect(calls[0]).toContain('days=7')

    await userEvent.click(screen.getByRole('button', { name: 'Месяц' }))
    await waitFor(() => expect(calls.at(-1)).not.toContain('days=7'))

    const asked = new URL(calls.at(-1)!, 'http://x').searchParams
    const from = asked.get('from')!
    // The 1st, and exactly as many days as that month has — 30 was the old
    // answer and it came up a day short in every 31-day month.
    expect(from.slice(8)).toBe('01')
    expect(Number(asked.get('days'))).toBe(lengthOf(from.slice(0, 7)))

    await userEvent.click(screen.getByRole('button', { name: 'Неделя' }))
    await waitFor(() => expect(calls.at(-1)).toContain('days=7'))
  })

  it('steps a month view by whole months, not by its length in days', async () => {
    const calls: string[] = []
    await openBoard(calls)

    await userEvent.click(screen.getByRole('button', { name: 'Месяц' }))
    await waitFor(() => expect(calls.at(-1)).not.toContain('days=7'))
    const first = new URL(calls.at(-1)!, 'http://x').searchParams.get('from')!

    await userEvent.click(screen.getByRole('button', { name: 'Следующий период' }))
    await waitFor(() => {
      const next = new URL(calls.at(-1)!, 'http://x').searchParams.get('from')!
      expect(next).not.toBe(first)
    })

    const next = new URL(calls.at(-1)!, 'http://x').searchParams.get('from')!
    // Still the 1st: stepping by thirty days would have landed mid-month and
    // stopped it being a calendar month at all.
    expect(next.slice(8)).toBe('01')
    const months = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7))
    expect(months(next) - months(first)).toBe(1)
  })

  it('shows a year as twelve months, not as 365 days', async () => {
    const calls: string[] = []
    await openBoard(calls)

    await userEvent.click(screen.getByRole('button', { name: 'Год' }))
    await waitFor(() => expect(calls.at(-1)).toContain('/rooms/year'))

    // Twelve columns per room, and no day request — a year at day granularity
    // would be ~17 000px of sideways scrolling.
    await waitFor(() => expect(document.querySelectorAll('.tl-month').length).toBe(24))
    expect(calls.at(-1)).not.toContain('/rooms/timeline')

    // Nights sold are printed, not only shaded: colour is never the only
    // carrier of the number.
    const row = [...document.querySelectorAll('.tl-row')].find(
      (r) => r.querySelector('.tl-room')?.textContent === '101'
    )!
    const cells = [...row.querySelectorAll('.tl-month')]
    expect(cells[7].textContent).toBe('30')
    expect(cells[7].getAttribute('data-fill')).toBe('full')
    // A month with nothing booked stays blank rather than printing a nought.
    expect(cells[0].textContent).toBe('')
    expect(cells[0].getAttribute('data-fill')).toBe('none')

    // The headline is the whole year, not the one busy month: 44 nights sold
    // out of 720 available across twelve months is 6%, even though August
    // itself is full. Reading August's 73% as "the year" is exactly the
    // mistake this label exists to prevent.
    expect(screen.getByText(/2026 · занято 6%/)).toBeInTheDocument()
  })

  it('opens a month by days when its cell is pressed', async () => {
    const calls: string[] = []
    await openBoard(calls)

    await userEvent.click(screen.getByRole('button', { name: 'Год' }))
    await waitFor(() => expect(document.querySelectorAll('.tl-month').length).toBe(24))

    // August, the eighth column of the first room.
    await userEvent.click(document.querySelectorAll('.tl-month')[7] as HTMLElement)

    await waitFor(() => expect(calls.at(-1)).toContain('/rooms/timeline'))
    const asked = new URL(calls.at(-1)!, 'http://x').searchParams
    expect(asked.get('from')).toBe('2026-08-01')
    expect(Number(asked.get('days'))).toBe(31)
    // And the scale control followed, so the board says where it is.
    expect(screen.getByRole('button', { name: 'Месяц' })).toHaveClass('active')
  })

  it('steps by the window and jumps straight to a date', async () => {
    const calls: string[] = []
    await openBoard(calls)

    const first = new URL(calls[0], 'http://x').searchParams.get('from')!
    await userEvent.click(screen.getByRole('button', { name: 'Следующий период' }))
    await waitFor(() => {
      const next = new URL(calls.at(-1)!, 'http://x').searchParams.get('from')!
      expect((Date.parse(next) - Date.parse(first)) / 86_400_000).toBe(7)
    })

    const jump = document.querySelector('.timeline-jump input') as HTMLInputElement
    fireEvent.change(jump, { target: { value: '2027-03-08' } })
    await waitFor(() => expect(calls.at(-1)).toContain('from=2027-03-08'))
  })

  it('shows every room in a far-future window, booked or not', async () => {
    const calls: string[] = []
    await openBoard(calls, {
      ...TIMELINE,
      from: '2027-03-08',
      rooms: TIMELINE.rooms.map((room) => ({ ...room, bookings: [] })),
    })

    await waitFor(() => expect(document.querySelectorAll('.tl-cell').length).toBe(14))
    expect(document.querySelectorAll('.tl-bar')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '101' })).toBeInTheDocument()
    // Everything free, so nothing is flagged as tight.
    expect(document.querySelectorAll('.tl-free.is-low')).toHaveLength(0)
  })

  it('leaves the restaurant page alone', async () => {
    signIn('admin')
    mockApi(baseRoutes('admin', [GAZEBO]))
    renderApp(<App />, { route: '/restaurant' })

    await screen.findByRole('heading', { name: 'Зона отдыха' })
    expect(screen.queryByRole('button', { name: 'Шахматка' })).not.toBeInTheDocument()
    expect(document.querySelector('.timeline')).toBeNull()
  })
})

describe('§14 manual "send to cleaning"', () => {
  const FREE_ROOM = makeUnit({ id: 6, name: '106', status: 'free' })

  const OCCUPIED = makeUnit({
    id: 5, name: '105', status: 'occupied',
    current_booking: {
      id: 42, guest_name: 'Асель Жумабаева', guest_phone: '+77073148820',
      date_from: '2026-08-07', date_to: '2026-08-10', status: 'occupied', is_paid: false,
      total_amount: 240000, prepaid_amount: 120000, deposit_amount: 0,
      charges_amount: 0, remaining_amount: 120000, currency: 'KZT',
    },
  })

  const FRESH = [
    { id: 91, unit_id: 6, booking_id: null, item_name: 'Смена постельного белья',
      is_done: false, updated_at: null, updated_by: null, updated_by_name: null },
    { id: 92, unit_id: 6, booking_id: null, item_name: 'Уборка санузла',
      is_done: false, updated_at: null, updated_by: null, updated_by_name: null },
  ]

  function detailRoutes(unit: ReturnType<typeof makeUnit>, resets: string[]) {
    return {
      ...baseRoutes('admin', [unit]),
      [`GET /api/units/${unit.id}`]: unit,
      [`GET /api/units/${unit.id}/calendar`]: { ...CALENDAR, unit: { id: unit.id, name: unit.name, type: 'room' } },
      'GET /api/cleaning/unit/': [],
      'GET /api/bookings/42/payments': [],
      'GET /api/bookings/42/charges': [],
      'GET /api/settings/preview': { empty: true, sections: 0, text: '' },
      [`POST /api/cleaning/unit/${unit.id}/reset`]: (url: string) => {
        resets.push(url)
        return FRESH
      },
    }
  }

  it('starts a fresh checklist for a room that has none', async () => {
    const resets: string[] = []
    signIn('admin')
    mockApi(detailRoutes(FREE_ROOM, resets))
    renderApp(<App />, { route: '/rooms/6' })

    await screen.findByRole('heading', { name: /Номер 106/ })
    expect(screen.getByText('не начат')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Отправить на уборку' }))

    await waitFor(() => expect(resets).toHaveLength(1))
    expect(resets[0]).toContain('/api/cleaning/unit/6/reset')
    // The new list is shown straight away, unticked.
    expect(await screen.findByText('Смена постельного белья')).toBeInTheDocument()
    expect(screen.getByText('0 / 2')).toBeInTheDocument()
  })

  it('asks before resetting a room a guest is still in', async () => {
    const resets: string[] = []
    signIn('admin')
    mockApi(detailRoutes(OCCUPIED, resets))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp(<App />, { route: '/rooms/5' })

    await screen.findByRole('heading', { name: /Номер 105/ })
    await userEvent.click(screen.getByRole('button', { name: 'Отправить на уборку' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('проживает гость'))
    // Declined, so nothing was sent.
    expect(resets).toHaveLength(0)

    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Отправить на уборку' }))
    await waitFor(() => expect(resets).toHaveLength(1))
    confirm.mockRestore()
  })

  it('does not ask when the room is empty', async () => {
    const resets: string[] = []
    signIn('admin')
    mockApi(detailRoutes(FREE_ROOM, resets))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderApp(<App />, { route: '/rooms/6' })

    await screen.findByRole('heading', { name: /Номер 106/ })
    await userEvent.click(screen.getByRole('button', { name: 'Отправить на уборку' }))

    await waitFor(() => expect(resets).toHaveLength(1))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('offers the same action on a recreation unit', async () => {
    const resets: string[] = []
    const gazebo = makeUnit({ id: 20, type: 'gazebo', name: 'Беседка 1', status: 'free' })
    signIn('admin')
    mockApi(detailRoutes(gazebo, resets))
    renderApp(<App />, { route: '/units/20' })

    await screen.findByRole('heading', { name: 'Беседка 1' })
    await userEvent.click(screen.getByRole('button', { name: 'Отправить на уборку' }))
    await waitFor(() => expect(resets[0]).toContain('/api/cleaning/unit/20/reset'))
  })

  it('keeps the action away from a waiter', async () => {
    const resets: string[] = []
    const gazebo = makeUnit({ id: 20, type: 'gazebo', name: 'Беседка 1', status: 'free' })
    signIn('waiter')
    mockApi({ ...detailRoutes(gazebo, resets), 'GET /api/auth/me': { user: STAFF.waiter } })
    renderApp(<App />, { route: '/units/20' })

    await screen.findByRole('heading', { name: 'Беседка 1' })
    // The reset endpoint is admin/housekeeper only; offering it here would
    // just hand the waiter a 403.
    expect(screen.queryByRole('button', { name: 'Отправить на уборку' })).not.toBeInTheDocument()
  })
})

// These pin the page to the server's flag in both positions, so whichever way
// the decision goes it stays a one-line server change. Staff notifications
// themselves no longer depend on it — see §15.
describe('§14 the settings page follows the server delivery flag', () => {
  const SETTINGS = (over: Record<string, unknown> = {}) => ({
    notifications: {
      notify_checkins: true, notify_checkouts: true,
      notify_cleaning: true, notify_unpaid: true,
    },
    channel: 'whatsapp',
    external_delivery: false,
    whatsapp_configured: false,
    telegram_configured: false,
    text: { hotel_name: 'Taura', hotel_details: '', reviews_2gis_url: '', reviews_google_url: '' },
    ...over,
  })

  const routes = (settings: unknown) => ({
    'GET /api/auth/me': { user: STAFF.admin },
    'GET /api/units': [makeUnit()],
    'GET /api/cleaning': { sla_minutes: 60, units: [] },
    'GET /api/alerts': { sla_minutes: 60, booking_window_hours: 8, alerts: [] },
    'GET /api/backup/stored': { configured: true, kind: 'kv', retention: 7, backups: [] },
    'GET /api/settings': settings,
  })

  it('shows the channels as out of use rather than as a broken feature', async () => {
    signIn('admin')
    mockApi(routes(SETTINGS()))
    renderApp(<App />, { route: '/settings' })

    await screen.findByRole('heading', { name: 'Настройки' })

    for (const label of ['WhatsApp', 'Telegram', 'Оба']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
    expect(
      screen.getByText(/Не используется — персонал работает через приложение/)
    ).toBeInTheDocument()
  })

  it('drops the credential warnings and the test button', async () => {
    signIn('admin')
    mockApi(routes(SETTINGS()))
    renderApp(<App />, { route: '/settings' })

    await screen.findByRole('heading', { name: 'Настройки' })

    // Nothing should read as "live but misconfigured" any more.
    expect(screen.queryByText(/green-api\.com/)).not.toBeInTheDocument()
    expect(screen.queryByText(/GREEN_API_INSTANCE_ID/)).not.toBeInTheDocument()
    expect(screen.queryByText(/TELEGRAM_BOT_TOKEN/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Отправить тест/ })).not.toBeInTheDocument()
  })

  it('keeps the digest content toggles live — they feed the dashboard panel', async () => {
    signIn('admin')
    mockApi(routes(SETTINGS()))
    renderApp(<App />, { route: '/settings' })

    await screen.findByRole('heading', { name: 'Настройки' })
    expect(screen.getByText('Что попадает в сводку')).toBeInTheDocument()

    const toggle = screen.getByText('Заезды').closest('button')!
    expect(toggle).not.toBeDisabled()
  })

  it('brings the controls back if the server ever re-enables delivery', async () => {
    signIn('admin')
    mockApi(routes(SETTINGS({ external_delivery: true, whatsapp_configured: true })))
    renderApp(<App />, { route: '/settings' })

    await screen.findByRole('heading', { name: 'Настройки' })

    // The page follows the server flag rather than hardcoding the decision.
    expect(screen.getByRole('button', { name: 'WhatsApp' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /Отправить тест/ })).toBeInTheDocument()
  })
})

/**
 * Push notifications, from the page's side.
 *
 * jsdom has no PushManager, which is exactly the environment of a browser that
 * cannot do this — so the default here exercises the degraded path, and the
 * capable path is reached by planting the APIs. What is being pinned is that
 * each distinct reason a phone will not ring produces its own instruction, in
 * particular the iPhone-in-a-tab case, which is silent in the platform and
 * would otherwise look like the feature being broken.
 */
describe('§15 notifications page', () => {
  const routes = (over: Record<string, unknown> = {}) => ({
    'GET /api/auth/me': { user: STAFF.housekeeper },
    'GET /api/units': [makeUnit()],
    'GET /api/cleaning': { sla_minutes: 60, units: [] },
    'GET /api/alerts': { sla_minutes: 60, booking_window_hours: 8, alerts: [] },
    'GET /api/push/key': { configured: true, public_key: 'BPublicKeyStub' },
    'GET /api/push/devices': { devices: [] },
    ...over,
  })

  // Capability probing reads globals, and a property planted on `navigator`
  // outlives the test that planted it. Without this, the second test in the
  // file would be probing the first test's browser.
  beforeEach(() => {
    for (const key of ['userAgent', 'standalone', 'serviceWorker'] as const) {
      delete (navigator as unknown as Record<string, unknown>)[key]
    }
    delete (window as { PushManager?: unknown }).PushManager
  })

  /**
   * jsdom has neither a service worker nor a PushManager, so the capability
   * probe has to be given a browser to look at. The iPhone-in-a-tab case is
   * precisely "service worker yes, PushManager no" — planting exactly that is
   * what makes this a test of the real branch rather than of a mock.
   */
  const asIphoneTab = () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: vi.fn(), ready: Promise.resolve({}), getRegistration: vi.fn() },
    })
    // Safari in a tab exposes no PushManager at all; that absence is the signal.
    delete (window as { PushManager?: unknown }).PushManager
  }

  it('tells an iPhone in a Safari tab to add the app to the home screen', async () => {
    asIphoneTab()
    signIn('housekeeper')
    mockApi(routes())
    renderApp(<App />, { route: '/notifications' })

    await screen.findByRole('heading', { name: 'Уведомления' })
    expect(screen.getByText(/На экран „Домой“/)).toBeInTheDocument()
    // The enable button must not look like the fix — it is not.
    expect(screen.getByRole('button', { name: 'Включить уведомления' })).toBeDisabled()
  })

  it('explains itself rather than going blank where push cannot work at all', async () => {
    signIn('housekeeper')
    mockApi(routes())
    renderApp(<App />, { route: '/notifications' })

    await screen.findByRole('heading', { name: 'Уведомления' })
    expect(screen.getByText(/не поддерживает/)).toBeInTheDocument()
    // The in-app fallback is named, so nobody concludes work goes unseen.
    expect(screen.getByText(/колокольчике/)).toBeInTheDocument()
  })

  it('names the missing server secrets instead of blaming the phone', async () => {
    signIn('housekeeper')
    mockApi(routes({ 'GET /api/push/key': { configured: false, public_key: null } }))
    renderApp(<App />, { route: '/notifications' })

    await screen.findByRole('heading', { name: 'Уведомления' })
    expect(screen.getByText(/VAPID_PUBLIC_KEY/)).toBeInTheDocument()
  })

  it('lists the devices a person has registered', async () => {
    signIn('housekeeper')
    mockApi(
      routes({
        'GET /api/push/devices': {
          devices: [
            {
              id: 1,
              endpoint: 'https://fcm.googleapis.com/x',
              user_agent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126',
              created_at: '2026-08-10 09:15:00',
              last_ok_at: '2026-08-10 11:00:00',
            },
          ],
        },
      })
    )
    renderApp(<App />, { route: '/notifications' })

    await screen.findByRole('heading', { name: 'Уведомления' })
    expect(screen.getByText('Android')).toBeInTheDocument()
    expect(screen.getByText('2026-08-10 11:00')).toBeInTheDocument()
  })

  it('tells a waiter what will actually reach them, in their own terms', async () => {
    signIn('waiter')
    mockApi({
      ...routes(),
      'GET /api/auth/me': { user: STAFF.waiter },
    })
    renderApp(<App />, { route: '/notifications' })

    await screen.findByRole('heading', { name: 'Уведомления' })
    // Someone deciding whether to let their phone interrupt them needs to know
    // what for. A waiter gets arrivals, not rooms and not the waitlist.
    expect(screen.getByText(/скорый приезд гостей/)).toBeInTheDocument()
    expect(screen.queryByText(/листу ожидания/)).not.toBeInTheDocument()
  })

  it('tells a housekeeper something different', async () => {
    signIn('housekeeper')
    mockApi(routes())
    renderApp(<App />, { route: '/notifications' })

    await screen.findByRole('heading', { name: 'Уведомления' })
    expect(screen.getByText(/номера, где уборка просрочена/)).toBeInTheDocument()
    expect(screen.queryByText(/приезд гостей/)).not.toBeInTheDocument()
  })
})

/**
 * The login screen's half of brute-force protection.
 *
 * The server does the work; what matters here is that its answer reaches the
 * person. A lockout that surfaced as a generic "неверный телефон или PIN"
 * would send someone hunting for a typo through a wait they cannot shorten.
 */
describe('§17 login lockout reaches the person', () => {
  it('shows the wait the server asked for, rather than a generic refusal', async () => {
    // mockApi answers 200 to everything, and the status code is the point here,
    // so fetch is stubbed directly for this one case.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/auth/login')) {
        return new Response(
          JSON.stringify({ error: 'Слишком много попыток входа. Повторите через 5 мин.' }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    })

    renderApp(<App />, { route: '/login' })

    await userEvent.type(screen.getByLabelText('Телефон'), '+77011112233')
    await userEvent.type(screen.getByLabelText('PIN-код'), '0000')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByText(/Слишком много попыток входа/)).toBeInTheDocument()
    expect(screen.getByText(/через 5 мин/)).toBeInTheDocument()
  })
})

/**
 * The phone navigation toggle.
 *
 * jsdom applies no media queries, so what is testable here is the state, not
 * the visibility — and the state is the part with a bug worth catching:
 * a menu that stayed open after you tapped a link would cover the page you
 * just asked for.
 */
describe('§18 the section list collapses on a phone', () => {
  const routes = {
    'GET /api/auth/me': { user: STAFF.admin },
    'GET /api/units': [makeUnit()],
    'GET /api/cleaning': { sla_minutes: 60, units: [] },
    'GET /api/alerts': { sla_minutes: 60, booking_window_hours: 8, alerts: [] },
    'GET /api/settings': { notifications: {}, telegram_configured: false },
    'GET /api/analytics/summary': {},
    'GET /api/units/forecast': { total_units: 14, days: [] },
    'GET /api/settings/preview': { empty: true, sections: 0, text: '' },
  }

  it('starts closed and opens on demand', async () => {
    signIn('admin')
    mockApi(routes)
    renderApp(<App />, { route: '/rooms' })

    const toggle = await screen.findByRole('button', { name: 'Показать разделы' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    expect(
      await screen.findByRole('button', { name: 'Скрыть разделы' })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('gets out of the way once a section is chosen', async () => {
    signIn('admin')
    mockApi(routes)
    renderApp(<App />, { route: '/rooms' })

    await userEvent.click(await screen.findByRole('button', { name: 'Показать разделы' }))
    const nav = screen.getByRole('navigation', { name: 'Разделы' })
    await userEvent.click(within(nav).getByRole('link', { name: 'Уборка' }))

    // Back to closed, so the page just navigated to is actually visible.
    expect(
      await screen.findByRole('button', { name: 'Показать разделы' })
    ).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('§19 a saved booking is read back before the form closes', () => {
  const EMPTY_BOARD = {
    from: '2026-08-09',
    days: 7,
    max_days: 30,
    dates: ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
            '2026-08-14', '2026-08-15'],
    rooms: [{ unit_id: 6, unit_name: '104', category: 'standard', capacity: 2, bookings: [] }],
  }

  type Call = { method: string; path: string; body: Record<string, unknown> }

  /** The booking the server would have written, built from what was sent. */
  function saved(body: Record<string, unknown>, over: Record<string, unknown> = {}) {
    const total = Number(body.total_amount ?? 0)
    const prepaid = Number(body.prepaid_amount ?? 0)
    return {
      id: 91,
      unit_id: 6,
      guest_name: body.guest_name,
      guest_phone: body.guest_phone,
      date_from: body.date_from,
      date_to: body.date_to,
      status: body.status,
      is_paid: total <= prepaid,
      verified_at: null,
      verified_by_name: null,
      total_amount: total,
      prepaid_amount: prepaid,
      deposit_amount: Number(body.deposit_amount ?? 0),
      charges_amount: 0,
      remaining_amount: total - prepaid,
      currency: 'KZT',
      ...over,
    }
  }

  function routes(calls: Call[]) {
    const record = (method: string, path: string) => (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      calls.push({ method, path, body })
      return path.endsWith('/verify')
        ? { ...saved(latest(calls)), verified_at: '2026-08-09 16:20', verified_by_name: STAFF.admin.name }
        : saved(latest(calls))
    }
    // The stubs echo whatever was last sent with a body, so a correction shows
    // up in the card exactly as the server would have returned it.
    const latest = (all: Call[]) =>
      [...all].reverse().find((call) => Object.keys(call.body).length > 0)?.body ?? {}

    return {
      ...baseRoutes('admin', []),
      'GET /api/rooms/timeline': EMPTY_BOARD,
      'GET /api/staff': [{ ...STAFF.admin, is_active: true }],
      'POST /api/bookings': record('POST', '/api/bookings'),
      'PATCH /api/bookings/91': record('PATCH', '/api/bookings/91'),
      'PATCH /api/bookings/91/payment': record('PATCH', '/api/bookings/91/payment'),
      'POST /api/bookings/91/verify': record('POST', '/api/bookings/91/verify'),
    }
  }

  /** Board → drag three nights → fill the form → save. */
  async function bookThreeNights(calls: Call[], { prepaid = '50000' } = {}) {
    signIn('admin')
    mockApi(routes(calls))
    renderApp(<App />, { route: '/rooms' })
    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(document.querySelector('.tl-cell')).toBeTruthy())

    const cells = [...document.querySelectorAll('.tl-cell')]
    fireEvent.pointerDown(cells[1], { pointerType: 'mouse' })
    for (const cell of cells.slice(2, 4)) fireEvent.pointerEnter(cell, { pointerType: 'mouse' })
    fireEvent.pointerUp(window)

    await screen.findByRole('heading', { name: 'Новая бронь' })
    await userEvent.type(screen.getByLabelText('Гость'), 'Асель Жумабаева')
    fireEvent.change(screen.getByLabelText('Сумма'), { target: { value: '200000' } })
    fireEvent.change(screen.getByLabelText('Предоплата'), { target: { value: prepaid } })
    if (prepaid !== '0') {
      fireEvent.change(screen.getByLabelText('Способ предоплаты'), { target: { value: 'kaspi' } })
    }
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  }

  it('shows the booking back instead of closing, with what was actually written', async () => {
    const calls: Call[] = []
    await bookThreeNights(calls)

    const card = await screen.findByRole('heading', { name: 'Проверьте бронь' })
    expect(card).toBeInTheDocument()

    const modal = document.querySelector('.modal') as HTMLElement
    // The room by its name, not the id the form worked with.
    expect(within(modal).getByText('104')).toBeInTheDocument()
    expect(within(modal).getByText('Асель Жумабаева')).toBeInTheDocument()
    // Three nights, counted rather than left for the reader to subtract.
    expect(within(modal).getByText(/3 ночи/)).toBeInTheDocument()
    // How the prepayment arrived and whose hands it went into.
    expect(within(modal).getByText(/Kaspi/)).toBeInTheDocument()
    expect(within(modal).getByText(new RegExp(STAFF.admin.name))).toBeInTheDocument()
    expect(within(modal).getByText(/150 000/)).toBeInTheDocument()
  })

  it('records the check against whoever pressed it', async () => {
    const calls: Call[] = []
    await bookThreeNights(calls)

    await screen.findByRole('heading', { name: 'Проверьте бронь' })
    await userEvent.click(screen.getByRole('button', { name: 'Проверено' }))

    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/bookings/91/verify')).toBe(true)
    )
    // And the form is done with — the booking was checked, not merely saved.
    await waitFor(() => expect(document.querySelector('.modal')).toBeNull())
  })

  it('corrects the booking it just made rather than saving a second one', async () => {
    const calls: Call[] = []
    await bookThreeNights(calls)

    await screen.findByRole('heading', { name: 'Проверьте бронь' })
    await userEvent.click(screen.getByRole('button', { name: 'Исправить' }))

    // Back in the form, still holding everything that was typed.
    expect(await screen.findByRole('heading', { name: 'Бронь #91' })).toBeInTheDocument()
    expect(screen.getByLabelText('Гость')).toHaveValue('Асель Жумабаева')

    fireEvent.change(screen.getByLabelText('Сумма'), { target: { value: '300000' } })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    // One booking, patched — not two bookings for the same three nights.
    await waitFor(() =>
      expect(calls.filter((call) => call.path === '/api/bookings')).toHaveLength(1)
    )
    expect(calls.some((call) => call.path === '/api/bookings/91/payment')).toBe(true)

    // And read back again: a correction is where a second mistake gets in.
    await screen.findByRole('heading', { name: 'Проверьте бронь' })
    expect(
      within(document.querySelector('.modal') as HTMLElement).getByText(/250 000/)
    ).toBeInTheDocument()
  })

  it('lets the card be dismissed unchecked, and says so by leaving no stamp', async () => {
    const calls: Call[] = []
    await bookThreeNights(calls)

    await screen.findByRole('heading', { name: 'Проверьте бронь' })
    await userEvent.click(document.querySelector('.modal-backdrop') as HTMLElement)

    await waitFor(() => expect(document.querySelector('.modal')).toBeNull())
    // The booking is saved either way; what is absent is the claim that anyone
    // checked it, which is exactly what the column is for.
    expect(calls.some((call) => call.path === '/api/bookings/91/verify')).toBe(false)
  })
})

describe('§20 printing from a unit, a booking or a person', () => {
  const ROOM = makeUnit({
    id: 5,
    name: '105',
    category: 'комфорт',
    status: 'occupied',
    current_booking: {
      id: 42,
      guest_name: 'Асель Жумабаева',
      guest_phone: '+77073148820',
      date_from: '2026-08-07',
      date_to: '2026-08-10',
      status: 'occupied',
      is_paid: false,
      total_amount: 240000,
      prepaid_amount: 120000,
      deposit_amount: 0,
      charges_amount: 0,
      remaining_amount: 120000,
      currency: 'KZT',
    },
  })

  const UNIT_BOOKINGS = [
    {
      id: 42,
      guest_name: 'Асель Жумабаева',
      guest_phone: '+77073148820',
      date_from: '2026-08-07',
      date_to: '2026-08-10',
      status: 'occupied',
      is_paid: false,
      verified_at: '2026-08-07 11:00',
      total_amount: 240000,
      prepaid_amount: 120000,
      charges_amount: 0,
      remaining_amount: 120000,
      currency: 'KZT',
    },
    {
      id: 43,
      guest_name: 'Ерлан Сатыбалдиев',
      guest_phone: '+77015550000',
      date_from: '2026-08-20',
      date_to: '2026-08-22',
      status: 'booked',
      is_paid: true,
      verified_at: null,
      total_amount: 80000,
      prepaid_amount: 80000,
      charges_amount: 0,
      remaining_amount: 0,
      currency: 'KZT',
    },
  ]

  const HISTORY = {
    phone: '+77073148820',
    guest_name: 'Асель Жумабаева',
    total_stays: 2,
    past_stays: 1,
    outstanding_debt: 120000,
    lifetime_spend: 300000,
    notes: 'Просит номер подальше от лифта',
    notes_updated_at: '2026-08-01 10:00',
    stays: [
      {
        booking_id: 42,
        unit_name: '105',
        unit_type: 'room' as const,
        date_from: '2026-08-07',
        date_to: '2026-08-10',
        status: 'occupied' as const,
        total_amount: 240000,
        charges_amount: 0,
        prepaid_amount: 120000,
        deposit_amount: 0,
        remaining_amount: 120000,
        currency: 'KZT',
      },
    ],
  }

  const SETTINGS = {
    notifications: {},
    telegram_configured: false,
    text: { hotel_name: 'Taura', hotel_details: 'Алматы, ул. Пример 1' },
  }

  function unitRoutes() {
    return {
      ...baseRoutes('admin', [ROOM]),
      'GET /api/settings': SETTINGS,
      'GET /api/units/5': ROOM,
      'GET /api/units/5/calendar': CALENDAR,
      'GET /api/bookings': UNIT_BOOKINGS,
      'GET /api/bookings/42/payments': [],
      'GET /api/bookings/42/charges': [],
      'GET /api/guests/': HISTORY,
    }
  }

  it('prints an object with what is booked in it, phones and balances', async () => {
    signIn('admin')
    mockApi(unitRoutes())
    renderApp(<App />, { route: '/rooms/5' })

    await userEvent.click(await screen.findByRole('button', { name: 'Печать по объекту' }))
    const sheet = (await screen.findByText(/брони на 30 дней/)).closest('.print-sheet')!
    const q = within(sheet as HTMLElement)

    // Hotel identity from settings, as on every other sheet.
    expect(q.getByText('Taura')).toBeInTheDocument()
    expect(q.getByText('Алматы, ул. Пример 1')).toBeInTheDocument()

    // Both bookings, with the phone numbers this sheet exists to carry.
    expect(q.getByText('Асель Жумабаева')).toBeInTheDocument()
    expect(q.getByText('Ерлан Сатыбалдиев')).toBeInTheDocument()
    expect(q.getByText('+77015550000')).toBeInTheDocument()

    // Five nights across the two stays, counted rather than left to the reader.
    expect(q.getByText(/занято 5 ночей/)).toBeInTheDocument()

    // The unchecked one is called out — this is the sheet read before arrival,
    // the last moment a wrong date can still be caught.
    expect(q.getByText('не проверена')).toBeInTheDocument()
  })

  it('prints a person with their stays, debt and the staff notes', async () => {
    signIn('admin')
    mockApi(unitRoutes())
    renderApp(<App />, { route: '/rooms/5' })

    await userEvent.click(await screen.findByRole('button', { name: 'История гостя →' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Печать карты гостя' }))

    const sheet = (await screen.findByText(/Карта гостя/)).closest('.print-sheet')!
    const q = within(sheet as HTMLElement)

    expect(q.getByText('+77073148820')).toBeInTheDocument()
    expect(q.getByText('Просит номер подальше от лифта')).toBeInTheDocument()
    expect(q.getByText(/бронь №42/)).toBeInTheDocument()
    expect(q.getByText('Долг по всем броням')).toBeInTheDocument()

    // Notes are written for colleagues, so the page says whose document it is
    // rather than leaving that to whoever picks it up off the printer.
    expect(q.getByText(/служебный документ/)).toBeInTheDocument()
  })

  it('prints any booking picked off the board, not just today’s', async () => {
    const TIMELINE = {
      from: '2026-08-09',
      days: 7,
      max_days: 30,
      dates: ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
              '2026-08-14', '2026-08-15'],
      rooms: [
        {
          unit_id: 5,
          unit_name: '105',
          category: 'комфорт',
          capacity: 2,
          bookings: [
            {
              id: 42,
              guest_name: 'Асель Жумабаева',
              guest_phone: '+77073148820',
              status: 'occupied' as const,
              date_from: '2026-08-10',
              date_to: '2026-08-13',
              total_amount: 240000,
              prepaid_amount: 120000,
              deposit_amount: 0,
              charges_amount: 0,
              remaining_amount: 120000,
              currency: 'KZT',
            },
          ],
        },
      ],
    }

    signIn('admin')
    mockApi({
      ...baseRoutes('admin', [ROOM]),
      'GET /api/settings': SETTINGS,
      'GET /api/rooms/timeline': TIMELINE,
      'GET /api/bookings/42/charges': [
        { id: 1, booking_id: 42, reason: 'Поздний выезд', amount: 18000,
          created_at: '2026-08-12', created_by_name: 'Нурлан' },
      ],
      'GET /api/bookings/42/payments': [
        { id: 1, booking_id: 42, amount: 120000, method: 'kaspi', paid_at: '2026-08-10 12:00',
          group_id: null, received_by: 3, received_by_name: 'Ержан Тулеуов',
          recorded_by: 1, recorded_by_name: 'Нурлан Абдразаков' },
      ],
    })
    renderApp(<App />, { route: '/rooms' })

    await waitFor(() => expect(document.querySelector('.tl-bar')).toBeTruthy())
    await userEvent.click(document.querySelector('.tl-bar') as HTMLElement)
    await userEvent.click(await screen.findByRole('button', { name: 'Печать инвойса' }))

    const sheet = (await screen.findByText('Инвойс')).closest('.print-sheet')!
    const q = within(sheet as HTMLElement)

    // The charge and the payment were fetched for this booking alone.
    expect(q.getByText(/Поздний выезд/)).toBeInTheDocument()
    // In Russian, not the raw column value — a guest reads this line.
    expect(q.getByText(/Kaspi/)).toBeInTheDocument()
    expect(q.getByText(/принял\(а\) Ержан Тулеуов/)).toBeInTheDocument()
  })
})

describe('§23 a unit with a guest in it can still be booked ahead', () => {
  const OCCUPIED = makeUnit({
    id: 5,
    name: '105',
    status: 'occupied',
    current_booking: {
      id: 42,
      guest_name: 'Асель Жумабаева',
      guest_phone: '+77073148820',
      date_from: '2026-08-07',
      date_to: '2026-08-12',
      status: 'occupied',
      is_paid: false,
      verified_at: null,
      total_amount: 240000,
      prepaid_amount: 120000,
      deposit_amount: 0,
      charges_amount: 0,
      remaining_amount: 120000,
      currency: 'KZT',
    },
  })

  function routes() {
    return {
      ...baseRoutes('admin', [OCCUPIED]),
      'GET /api/units/5': OCCUPIED,
      'GET /api/units/5/calendar': CALENDAR,
      'GET /api/bookings/42/payments': [],
      'GET /api/bookings/42/charges': [],
      'GET /api/staff': [{ ...STAFF.admin, is_active: true }],
    }
  }

  it('offers a new booking as well as editing the current one', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/5' })

    await screen.findByRole('heading', { name: /Номер 105/ })
    // Both, and they are different acts: one edits the stay running now, the
    // other takes a reservation for later. There used to be a single button
    // that became «Изменить бронь» whenever the room was occupied, which left
    // no way at all to book next week on a room with a guest in it today.
    expect(screen.getByRole('button', { name: 'Изменить бронь' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Новая бронь' })).toBeInTheDocument()
  })

  it('opens the new booking empty, starting the morning the guest leaves', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/5' })

    await screen.findByRole('heading', { name: /Номер 105/ })
    await userEvent.click(screen.getByRole('button', { name: 'Новая бронь' }))

    // A new booking, not booking 42 reopened.
    expect(await screen.findByRole('heading', { name: 'Новая бронь' })).toBeInTheDocument()
    expect(screen.getByLabelText('Гость')).toHaveValue('')

    // Defaulting to today would open the form on dates the server always
    // refuses, because today is taken.
    const dates = [...document.querySelectorAll('.modal input[type=date]')] as HTMLInputElement[]
    expect(dates[0].value).toBe('2026-08-12')
    expect(dates[1].value).toBe('2026-08-13')
  })

  it('still opens the running stay when that is what was asked for', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/5' })

    await screen.findByRole('heading', { name: /Номер 105/ })
    await userEvent.click(screen.getByRole('button', { name: 'Изменить бронь' }))

    expect(await screen.findByRole('heading', { name: 'Бронь #42' })).toBeInTheDocument()
    expect(screen.getByLabelText('Гость')).toHaveValue('Асель Жумабаева')
  })
})

describe('§24 a recreation unit shows its booking without leaving the grid', () => {
  // A sunbed, not a gazebo: «Топчаны» is the tab the page opens on, and a
  // gazebo fixture is filtered out of it before it ever reaches a card.
  const SUNBED_BOOKED = makeUnit({
    id: 20,
    type: 'sunbed',
    name: 'Топчан 1',
    status: 'occupied',
    current_booking: {
      id: 77,
      guest_name: 'Динара Касымова',
      guest_phone: '+77012223344',
      date_from: '2026-08-08 13:00',
      date_to: '2026-08-08 18:00',
      status: 'occupied',
      is_paid: false,
      verified_at: null,
      total_amount: 45000,
      prepaid_amount: 5000,
      deposit_amount: 0,
      charges_amount: 0,
      remaining_amount: 40000,
      currency: 'KZT',
    },
  })

  it('opens the details on the card itself when the "i" is pressed', async () => {
    signIn('admin')
    mockApi({ ...baseRoutes('admin', [SUNBED_BOOKED]), 'GET /api/units': [SUNBED_BOOKED] })
    renderApp(<App />, { route: '/restaurant' })

    await screen.findByRole('heading', { name: 'Зона отдыха' })
    await userEvent.click(await screen.findByRole('button', { name: 'Показать детали брони' }))

    const peek = document.querySelector('.unit-peek') as HTMLElement
    const q = within(peek)
    expect(q.getByText('Динара Касымова')).toBeInTheDocument()
    expect(q.getByText('+77012223344')).toBeInTheDocument()
    // Sold by the hour, so the clock and not a date range.
    expect(q.getByText(/13:00 — 18:00/)).toBeInTheDocument()
    expect(q.getByText(/40 000/)).toBeInTheDocument()
    // Still on the grid: the page did not navigate to the unit.
    expect(screen.getByRole('heading', { name: 'Зона отдыха' })).toBeInTheDocument()
  })

  it('does not follow the reader down the grid once they move away', async () => {
    signIn('admin')
    mockApi({ ...baseRoutes('admin', [SUNBED_BOOKED]), 'GET /api/units': [SUNBED_BOOKED] })
    renderApp(<App />, { route: '/restaurant' })

    await userEvent.click(await screen.findByRole('button', { name: 'Показать детали брони' }))
    expect(document.querySelector('.unit-peek')).toBeTruthy()

    // Leaving the card clears the pin as well as the hover, so a panel opened
    // on one card is not still open behind the next fourteen.
    await userEvent.unhover(document.querySelector('.unit-card') as HTMLElement)
    expect(document.querySelector('.unit-peek')).toBeNull()
  })

  it('offers nothing to open on a unit with no booking', async () => {
    const free = makeUnit({ id: 21, type: 'sunbed', name: 'Топчан 2', status: 'free' })
    signIn('admin')
    mockApi({ ...baseRoutes('admin', [free]), 'GET /api/units': [free] })
    renderApp(<App />, { route: '/restaurant' })

    await screen.findByRole('heading', { name: 'Зона отдыха' })
    expect(screen.queryByRole('button', { name: 'Показать детали брони' })).not.toBeInTheDocument()
  })
})

describe('§25 the board says when it is not showing today', () => {
  const TIMELINE = {
    from: '2026-08-10',
    days: 7,
    max_days: 31,
    dates: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
            '2026-08-15', '2026-08-16'],
    rooms: [{ unit_id: 5, unit_name: '101', category: 'standard', capacity: 2, bookings: [] }],
  }

  async function openBoard(calls: string[]) {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/rooms/timeline': (url: string) => {
        calls.push(url)
        return TIMELINE
      },
    })
    renderApp(<App />, { route: '/rooms' })
    await screen.findByRole('heading', { name: 'Номера' })
    await waitFor(() => expect(document.querySelector('.tl-row')).toBeTruthy())
  }

  it('keeps «Сегодня» quiet while today is on screen', async () => {
    await openBoard([])
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveClass('btn-ghost')
  })

  it('makes «Сегодня» the loud control once the board has been stepped away', async () => {
    const calls: string[] = []
    await openBoard(calls)

    await userEvent.click(screen.getByRole('button', { name: 'Предыдущий период' }))
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))

    // The board is showing exactly what was asked for — the point is that the
    // way back stops looking like decoration. Reported as "почему дата не
    // текущая?" after stepping back far enough to land in February.
    const back = screen.getByRole('button', { name: 'Сегодня' })
    expect(back).toHaveClass('btn-primary')
    expect(back).not.toHaveClass('btn-ghost')
  })

  it('goes quiet again when it is pressed', async () => {
    const calls: string[] = []
    await openBoard(calls)

    await userEvent.click(screen.getByRole('button', { name: 'Предыдущий период' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveClass('btn-primary'))

    await userEvent.click(screen.getByRole('button', { name: 'Сегодня' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveClass('btn-ghost')
    )
  })

  it('counts a calendar month containing today as showing today', async () => {
    const calls: string[] = []
    await openBoard(calls)

    // The month starts on the 1st and today is the 10th — still "today".
    await userEvent.click(screen.getByRole('button', { name: 'Месяц' }))
    await waitFor(() => expect(calls.at(-1)).not.toContain('days=7'))

    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveClass('btn-ghost')
  })
})

describe('§26 the phone gets its sections under a thumb', () => {
  /** jsdom has no matchMedia; the shell asks it whether we are on a phone. */
  function atPhoneWidth(isPhone: boolean) {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: isPhone,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    )
  }

  afterEach(() => vi.unstubAllGlobals())

  it('gives the admin the four pages of the day, plus a way to the rest', async () => {
    atPhoneWidth(true)
    signIn('admin')
    mockApi(baseRoutes('admin'))
    renderApp(<App />, { route: '/rooms' })

    const tabs = await screen.findByRole('navigation', { name: 'Основные разделы' })
    const labels = [...tabs.querySelectorAll('.mobile-tab-label')].map((e) => e.textContent)
    // «Отдых», not «Зона отдыха»: five labels share 390px, and a tab reading
    // «Зона отд…» looks like a fault rather than a shortening.
    //
    // «Сегодня» took the second tab and pushed «Уборка» into «Ещё». The bar
    // holds four plus «Ещё» — that limit is what keeps the labels readable —
    // so something had to give, and for an admin "кто заезжает" is asked far
    // more often than a page that mostly belongs to the housekeeper and is
    // still one tap away from the summary's own «Требуют уборки» tile.
    expect(labels).toEqual(['Сводка', 'Сегодня', 'Номера', 'Отдых', 'Ещё'])
  })

  it('gives a housekeeper her own page and her own notifications', async () => {
    atPhoneWidth(true)
    signIn('housekeeper')
    mockApi(baseRoutes('housekeeper'))
    renderApp(<App />, { route: '/cleaning' })

    const tabs = await screen.findByRole('navigation', { name: 'Основные разделы' })
    const labels = [...tabs.querySelectorAll('.mobile-tab-label')].map((e) => e.textContent)
    // Notifications are switched on per phone, so she has to reach them
    // herself — and she has one work page, so there is room.
    expect(labels).toEqual(['Уборка', 'Сигналы', 'Ещё'])
  })

  it('is not in the DOM at all on a desktop, so nothing is announced twice', async () => {
    atPhoneWidth(false)
    signIn('admin')
    mockApi(baseRoutes('admin'))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('link', { name: 'Номера' })
    expect(screen.queryByRole('navigation', { name: 'Основные разделы' })).not.toBeInTheDocument()
    // And exactly one link per destination.
    expect(screen.getAllByRole('link', { name: 'Номера' })).toHaveLength(1)
  })

  it('moves the account controls into the menu on a phone, not onto both', async () => {
    atPhoneWidth(true)
    signIn('admin')
    mockApi(baseRoutes('admin'))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('navigation', { name: 'Основные разделы' })
    // One «Выйти», and it is inside the menu sheet rather than the topbar.
    const exits = screen.getAllByRole('button', { name: 'Выйти' })
    expect(exits).toHaveLength(1)
    expect(exits[0].closest('.sidebar')).not.toBeNull()
    expect(document.querySelector('.topbar .who')).toBeNull()
  })
})

describe('§27 the journal is a table on a desktop and a column of cards on a phone', () => {
  /** jsdom has no matchMedia; the journal asks it whether we are on a phone. */
  function atPhoneWidth(isPhone: boolean) {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: isPhone,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    )
  }

  afterEach(() => vi.unstubAllGlobals())

  const AUDIT_ROUTES = {
    'GET /api/auth/me': { user: STAFF.admin },
    'GET /api/audit/filters': { actions: ['booking'], staff: [] },
    'GET /api/audit': {
      total: 2,
      limit: 50,
      offset: 0,
      entries: [
        {
          id: 9,
          staff_user_id: 1,
          staff_name: 'Нурлан Абдразаков',
          staff_role: 'admin',
          action: 'booking.update:free:no_payment',
          entity: 'bookings',
          entity_id: 42,
          created_at: '2026-08-08 18:20',
          target: '105',
          guest_name: 'Асель Жумабаева',
        },
        {
          id: 8,
          staff_user_id: 1,
          staff_name: 'Нурлан Абдразаков',
          staff_role: 'admin',
          action: 'login',
          entity: 'staff_users',
          entity_id: 1,
          created_at: '2026-08-08 09:02',
          target: null,
          guest_name: null,
        },
      ],
    },
  }

  it('stacks each entry on a phone, so nothing sits off the right edge', async () => {
    atPhoneWidth(true)
    signIn('admin')
    mockApi(AUDIT_ROUTES)
    renderApp(<App />, { route: '/audit' })

    // The object and the guest share one line, so there is no element holding
    // the guest's name on its own to wait for — the cards themselves are the
    // signal that the entries have landed.
    await waitFor(() =>
      expect(document.querySelectorAll('.audit-cards .row-card')).toHaveLength(2)
    )

    // The cards carry what the table's four columns carried.
    const cards = document.querySelectorAll('.audit-cards .row-card')
    expect(cards[0].textContent).toContain('Нурлан Абдразаков')
    expect(cards[0].textContent).toContain('2026-08-08 18:20')
    // The object of the entry — the thing the table hid 104px off the edge.
    expect(cards[0].textContent).toContain('105')
    expect(cards[0].textContent).toContain('Асель Жумабаева')

    // A sign-in has nothing to name, so the card stops rather than printing
    // the internal row id the table has to put in its cell.
    expect(cards[1].textContent).not.toContain('#1')
  })

  it('builds only one of the two, so fifty entries are never announced twice', async () => {
    atPhoneWidth(true)
    signIn('admin')
    mockApi(AUDIT_ROUTES)
    renderApp(<App />, { route: '/audit' })

    await waitFor(() =>
      expect(document.querySelectorAll('.audit-cards .row-card')).toHaveLength(2)
    )
    // One shape in the document, not one shown and one hidden.
    expect(document.querySelector('.audit-table')).toBeNull()
    expect(document.querySelectorAll('.audit-cards, .audit-table')).toHaveLength(1)
  })

  it('keeps the table on a desktop, where four columns fit', async () => {
    atPhoneWidth(false)
    signIn('admin')
    mockApi(AUDIT_ROUTES)
    renderApp(<App />, { route: '/audit' })

    await waitFor(() =>
      expect(document.querySelectorAll('.audit-table tbody tr')).toHaveLength(2)
    )
    expect(screen.getByText('Асель Жумабаева')).toBeInTheDocument()
    expect(document.querySelector('.audit-cards')).toBeNull()
  })
})

describe('§28 the invoice requisites use the whole row they are given', () => {
  const SETTINGS_ROUTES = {
    ...baseRoutes('admin'),
    'GET /api/settings': {
      notifications: {},
      channel: 'whatsapp',
      external_delivery: false,
      whatsapp_configured: false,
      telegram_configured: false,
      text: {
        hotel_name: 'Taura',
        hotel_details: 'Алматы, ул. Алма-Арасан 4а',
        reviews_2gis_url: '',
        reviews_google_url: '',
        invoice_legal_name: '',
        invoice_tax_id: '',
        invoice_legal_address: '',
        invoice_contact: '',
        invoice_bank: '',
        invoice_terms: '',
      },
    },
    'GET /api/backup/stored': { configured: false, kind: null, backups: [] },
  }

  it('pairs the narrow fields instead of leaving half of each row empty', async () => {
    signIn('admin')
    mockApi(SETTINGS_ROUTES)
    renderApp(<App />, { route: '/settings' })

    await screen.findByLabelText('Юридическое лицо')

    // `.field-row` is a two-column grid. A row holding one field leaves the
    // other column empty — which is what these four requisites used to do,
    // 489px of nothing beside each of them on a desktop.
    const rows = [...document.querySelectorAll('.field-row')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.querySelectorAll(':scope > .field')).toHaveLength(2)
    }
  })

  it('keeps the bank details and the payment terms across the full width', async () => {
    signIn('admin')
    mockApi(SETTINGS_ROUTES)
    renderApp(<App />, { route: '/settings' })

    // The two long ones are not inside a row at all — they are the full width
    // on their own, which is what `wide` has always meant.
    const bank = await screen.findByLabelText('Банковские реквизиты')
    const terms = screen.getByLabelText('Условия оплаты')
    expect(bank.closest('.field-row')).toBeNull()
    expect(terms.closest('.field-row')).toBeNull()
  })

  it('still offers every requisite the invoice can print', async () => {
    signIn('admin')
    mockApi(SETTINGS_ROUTES)
    renderApp(<App />, { route: '/settings' })

    for (const label of [
      'Юридическое лицо',
      'БИН / ИИН',
      'Юридический адрес',
      'Телефон / e-mail для счетов',
      'Банковские реквизиты',
      'Условия оплаты',
    ]) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument()
    }
  })
})

describe('§29 the waiter can answer the cleaning alerts they are sent', () => {
  it('gives them the Уборка page they are told to go to', async () => {
    signIn('waiter')
    mockApi(baseRoutes('waiter'))
    renderApp(<App />, { route: '/restaurant' })

    const nav = await screen.findByRole('navigation', { name: 'Разделы' })
    // The recreation checklist is «Убрать посуду», «Протереть стол и лавки» —
    // the waiter's job. Without this link the SLA alert they receive points at
    // a page they have no way to open.
    expect(within(nav).getByRole('link', { name: 'Уборка' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Номера' })).not.toBeInTheDocument()
  })

  it('lets them open it rather than bouncing them to the dashboard', async () => {
    signIn('waiter')
    mockApi({
      ...baseRoutes('waiter'),
      'GET /api/cleaning': {
        sla_minutes: 60,
        units: [
          { id: 20, type: 'gazebo', name: 'Беседка 1', category: null, total: 5, pending: 3,
            waiting_since: '2026-08-11 09:00', waiting_minutes: 95, is_overdue: true },
        ],
      },
      'GET /api/cleaning/unit/20': [
        { id: 1, unit_id: 20, booking_id: null, item_name: 'Убрать посуду', is_done: false,
          updated_at: null, updated_by: null, updated_by_name: null },
      ],
    })
    renderApp(<App />, { route: '/cleaning' })

    expect(await screen.findByRole('heading', { name: 'Уборка' })).toBeInTheDocument()

    // The gazebo is listed as a card and, being the first one, is also the
    // selected unit whose name titles the checklist panel beside it.
    const card = await screen.findByRole('button', { name: /Беседка 1/ })
    expect(card).toBeInTheDocument()
    expect(await screen.findByText('Убрать посуду')).toBeInTheDocument()
  })
})

describe('§30 the price list fills the amount in, and a person can overrule it', () => {
  const freeRoom6 = makeUnit({ id: 6, name: '106', status: 'free' })

  const QUOTE = {
    total: 60000,
    empty: false,
    nights: [
      { date: '2026-08-14', kind: 'weekend', season: null, price: 30000 },
      { date: '2026-08-15', kind: 'weekend', season: null, price: 30000 },
    ],
  }

  function routes(quote: unknown) {
    return {
      ...baseRoutes('admin', [freeRoom6]),
      'GET /api/units/6': freeRoom6,
      'GET /api/units/6/calendar': CALENDAR,
      'GET /api/rates/quote': quote,
      'GET /api/guests/': { total_stays: 0, notes: '', outstanding_debt: 0 },
    }
  }

  it('suggests the total and says which nights it is made of', async () => {
    signIn('admin')
    mockApi(routes(QUOTE))
    renderApp(<App />, { route: '/rooms/6' })

    await userEvent.click(await screen.findByRole('button', { name: 'Новая бронь' }))

    const total = (await screen.findByLabelText('Сумма')) as HTMLInputElement
    await waitFor(() => expect(total.value).toBe('60000'))
    // The breakdown is the check: an amount with no explanation is a number to
    // trust blindly, and this one is about to go on an invoice.
    expect(screen.getByText(/По прайсу/)).toBeInTheDocument()
  })

  it('never moves an amount a person has typed', async () => {
    signIn('admin')
    mockApi(routes(QUOTE))
    renderApp(<App />, { route: '/rooms/6' })

    await userEvent.click(await screen.findByRole('button', { name: 'Новая бронь' }))
    const total = (await screen.findByLabelText('Сумма')) as HTMLInputElement
    await waitFor(() => expect(total.value).toBe('60000'))

    await userEvent.clear(total)
    await userEvent.type(total, '45000')

    // Changing the dates re-quotes; the typed figure has to survive it, and the
    // way back to the list price is offered rather than taken.
    fireEvent.change(screen.getByLabelText('Заезд'), { target: { value: '2026-08-20' } })
    await waitFor(() => expect(screen.getByText(/вернуть/)).toBeInTheDocument())
    expect((screen.getByLabelText('Сумма') as HTMLInputElement).value).toBe('45000')
  })

  it('leaves the field alone when the price list has nothing to say', async () => {
    signIn('admin')
    mockApi(routes({ total: 0, nights: [], empty: true }))
    renderApp(<App />, { route: '/rooms/6' })

    await userEvent.click(await screen.findByRole('button', { name: 'Новая бронь' }))
    const total = (await screen.findByLabelText('Сумма')) as HTMLInputElement
    await waitFor(() => expect(screen.getByLabelText('Гость')).toBeInTheDocument())
    expect(total.value).toBe('')
    expect(screen.queryByText(/По прайсу/)).not.toBeInTheDocument()
  })
})

describe('§31 a booking that fell off the end of time can still be closed', () => {
  const STALE: Booking = {
    id: 85,
    guest_name: 'Не Заехал Тестовый',
    guest_phone: '+77009998877',
    date_from: '2026-08-08',
    date_to: '2026-08-10',
    status: 'booked',
  }

  const emptyRoom = makeUnit({ id: 2, name: '102', status: 'free' })
  const withStale = { ...emptyRoom, unclosed_booking: STALE }

  function routes() {
    return {
      ...baseRoutes('admin', [withStale]),
      'GET /api/units/2': withStale,
      'GET /api/units/2/calendar': { ...CALENDAR, unit: { id: 2, name: '102', type: 'room' } },
    }
  }

  it('says what happened, on the page the alert points at', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/2' })

    // The unit itself is free and the page rightly says so — the loose end is
    // reported beside that, not as the unit's status.
    expect(await screen.findByRole('heading', { name: 'Номер 102' })).toBeInTheDocument()
    expect(await screen.findByText(/Гость не заехал/)).toBeInTheDocument()
    expect(screen.getByText(/Не Заехал Тестовый/)).toBeInTheDocument()
  })

  it('opens that very booking, so it can be checked in or closed', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/2' })

    await userEvent.click(await screen.findByRole('button', { name: 'Открыть бронь' }))

    // The ordinary booking form, on booking 85 — nothing special was invented
    // for this, it just had to be reachable.
    expect(await screen.findByRole('heading', { name: 'Бронь #85' })).toBeInTheDocument()
    expect((screen.getByLabelText('Гость') as HTMLInputElement).value).toBe('Не Заехал Тестовый')
    expect((screen.getByLabelText('Заезд') as HTMLInputElement).value).toBe('2026-08-08')
    // «Выехал / отменена» is how it gets closed, and it is right there.
    expect([...(screen.getByLabelText('Статус') as HTMLSelectElement).options].map((o) => o.value))
      .toContain('free')
  })

  it('says nothing when there is no loose end', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin', [emptyRoom]),
      'GET /api/units/2': emptyRoom,
      'GET /api/units/2/calendar': { ...CALENDAR, unit: { id: 2, name: '102', type: 'room' } },
    })
    renderApp(<App />, { route: '/rooms/2' })

    await screen.findByRole('heading', { name: 'Номер 102' })
    expect(screen.queryByText(/Гость не заехал/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть бронь' })).not.toBeInTheDocument()
  })
})

describe('§32 миграционный учёт: иностранцев считаем, казахстанцев не трогаем', () => {
  const REGISTER = {
    today: '2026-08-11',
    notice_days: 3,
    hotel_name: 'Taura',
    hotel_address: 'ул. Алма-Арасан, 4а, Алматы',
    due: [
      {
        booking_id: 91, guest_name: 'Wei Zhang', guest_phone: null,
        guest_citizenship: 'Китай', guest_document: 'E12345678',
        date_from: '2026-08-10', date_to: '2026-08-13',
        unit_id: 11, unit_name: '111',
        migration_notified_at: null, migration_notified_by_name: null,
        due_on: '2026-08-13', days_left: 2,
      },
    ],
    unknown: [
      {
        booking_id: 92, guest_name: 'Гость Без Страны', guest_phone: null,
        guest_citizenship: null, guest_document: null,
        date_from: '2026-08-09', date_to: '2026-08-12',
        unit_id: 13, unit_name: '113',
        migration_notified_at: null, migration_notified_by_name: null,
      },
    ],
    filed: [],
  }

  it('shows the deadline and the data the notice asks for', async () => {
    signIn('admin')
    mockApi({ ...baseRoutes('admin'), 'GET /api/migration': REGISTER })
    renderApp(<App />, { route: '/migration' })

    expect(await screen.findByRole('heading', { name: 'Миграционный учёт' })).toBeInTheDocument()
    expect(await screen.findByText('Wei Zhang')).toBeInTheDocument()
    // The passport number and the countdown are the two things filing needs.
    expect(screen.getByText(/E12345678/)).toBeInTheDocument()
    expect(screen.getByText(/осталось 2 дн/)).toBeInTheDocument()
    // The receiving party and the address of stay, so nobody has to recall them.
    expect(screen.getByText(/ул. Алма-Арасан, 4а, Алматы/)).toBeInTheDocument()
  })

  it('keeps an unrecorded citizenship out of the legal list but on the page', async () => {
    signIn('admin')
    mockApi({ ...baseRoutes('admin'), 'GET /api/migration': REGISTER })
    renderApp(<App />, { route: '/migration' })

    await screen.findByText('Wei Zhang')
    // Not a deadline — but not silence either: most guests are Kazakh, and a
    // false deadline on nine in ten would train everyone to ignore the page.
    const unrecorded = screen.getByText('Гость Без Страны').closest('.row-card')!
    expect(unrecorded).toBeInTheDocument()
    expect(within(unrecorded as HTMLElement).queryByText(/осталось/)).not.toBeInTheDocument()
    expect(within(unrecorded as HTMLElement).queryByRole('button', { name: /подано/i }))
      .not.toBeInTheDocument()
  })

  it('asks a room booking for citizenship, and warns only for a foreign one', async () => {
    const freeRoom = makeUnit({ id: 6, name: '106', status: 'free' })
    signIn('admin')
    mockApi({
      ...baseRoutes('admin', [freeRoom]),
      'GET /api/units/6': freeRoom,
      'GET /api/units/6/calendar': CALENDAR,
    })
    renderApp(<App />, { route: '/rooms/6' })

    await userEvent.click(await screen.findByRole('button', { name: 'Новая бронь' }))
    const select = (await screen.findByLabelText('Гражданство')) as HTMLSelectElement

    // Blank is the default and a real answer — see BookingModal.
    expect(select.value).toBe('')
    expect(screen.queryByText(/миграционную службу нужно уведомить/)).not.toBeInTheDocument()

    await userEvent.selectOptions(select, 'KZ')
    expect(screen.queryByText(/миграционную службу нужно уведомить/)).not.toBeInTheDocument()

    await userEvent.selectOptions(select, 'Китай')
    expect(await screen.findByText(/миграционную службу нужно уведомить/)).toBeInTheDocument()
  })
})

describe('§33 нажатие на дату в календаре открывает бронь', () => {
  const room = makeUnit({ id: 6, name: '106', status: 'free' })
  const AUGUST = {
    unit: { id: 6, name: '106', type: 'room' },
    month: '2026-08',
    days: Array.from({ length: 31 }, (_, i) => {
      const date = `2026-08-${String(i + 1).padStart(2, '0')}`
      const busy = i >= 13 && i <= 15
      return {
        date,
        status: busy ? 'booked' : 'free',
        booking_id: busy ? 128 : null,
        guest_name: busy ? 'Кликнутый Гость' : null,
      }
    }),
  }
  const BOOKING = {
    id: 128, unit_id: 6, guest_name: 'Кликнутый Гость', guest_phone: null,
    date_from: '2026-08-14', date_to: '2026-08-16', status: 'booked',
  }

  function routes() {
    return {
      ...baseRoutes('admin', [room]),
      'GET /api/units/6': room,
      'GET /api/units/6/calendar': AUGUST,
      'GET /api/bookings': [BOOKING],
    }
  }

  it('makes every day a real button, named for a reader who cannot see colour', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/6' })

    await screen.findByRole('heading', { name: 'Номер 106' })
    // Colour alone says nothing to a screen reader, and «14» says almost as
    // little — the label carries the state and the action.
    expect(await screen.findByRole('button', { name: /14 авг.*Кликнутый Гость.*открыть бронь/ }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: /29 авг.*свободно.*забронировать/ }))
      .toBeInTheDocument()
  })

  it('opens the booking that is on the day pressed', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/6' })

    await userEvent.click(
      await screen.findByRole('button', { name: /14 авг.*Кликнутый Гость/ })
    )

    expect(await screen.findByRole('heading', { name: 'Бронь #128' })).toBeInTheDocument()
    expect((screen.getByLabelText('Гость') as HTMLInputElement).value).toBe('Кликнутый Гость')
  })

  it('starts a new booking on the day pressed, not on the next free one', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/6' })

    await userEvent.click(
      await screen.findByRole('button', { name: /29 авг.*свободно/ })
    )

    expect(await screen.findByRole('heading', { name: 'Новая бронь' })).toBeInTheDocument()
    // The day someone pressed is the day they meant.
    expect((screen.getByLabelText('Заезд') as HTMLInputElement).value).toBe('2026-08-29')
  })
})

describe('§34 НДС в инвойсе: выключен по умолчанию, включается переключателем', () => {
  const BOOKED = makeUnit({
    id: 5, name: '105', status: 'occupied',
    current_booking: {
      id: 42, guest_name: 'Асель Жумабаева', guest_phone: null,
      date_from: '2026-08-07', date_to: '2026-08-09', status: 'occupied',
      is_paid: false, total_amount: 100000, prepaid_amount: 0, deposit_amount: 0,
      charges_amount: 0, remaining_amount: 100000, currency: 'KZT',
    },
  })

  function routes(vat: Record<string, string>) {
    return {
      ...baseRoutes('admin', [BOOKED]),
      'GET /api/units/5': BOOKED,
      'GET /api/units/5/calendar': CALENDAR,
      'GET /api/bookings/42/payments': [],
      'GET /api/bookings/42/charges': [],
      'GET /api/settings': {
        notifications: {}, channel: 'whatsapp', whatsapp_configured: false,
        telegram_configured: false,
        text: { hotel_name: 'Taura', hotel_details: 'Алматы', ...vat },
      },
    }
  }

  async function openInvoice(vat: Record<string, string>) {
    signIn('admin')
    mockApi(routes(vat))
    renderApp(<App />, { route: '/rooms/5' })
    await userEvent.click(await screen.findByRole('button', { name: 'Печать инвойса' }))
    const heading = await screen.findByText('Инвойс')
    return within(heading.closest('.print-sheet') as HTMLElement)
  }

  it('prints no tax line at all while the hotel is not registered', async () => {
    const sheet = await openInvoice({ vat_registered: '0' })
    expect(sheet.getByText('Итого начислено')).toBeInTheDocument()
    expect(sheet.queryByText(/НДС/)).not.toBeInTheDocument()
  })

  it('states «в том числе НДС» when prices already contain it, leaving the total alone', async () => {
    const sheet = await openInvoice({
      vat_registered: '1', vat_rate: '16', vat_prices_include: '1',
    })
    // 100 000 with the tax inside is 100000 × 16 / 116 = 13 793.
    expect(sheet.getByText('В том числе НДС 16%')).toBeInTheDocument()
    expect(sheet.getByText('13 793 ₸')).toBeInTheDocument()
    // The amount owed has not moved: the guest was quoted the price they pay.
    expect(sheet.getByText('Итого начислено')).toBeInTheDocument()
    expect(sheet.getAllByText('100 000 ₸').length).toBeGreaterThan(0)
  })

  it('adds the tax on top when prices are net, and the total goes up by it', async () => {
    const sheet = await openInvoice({
      vat_registered: '1', vat_rate: '16', vat_prices_include: '0',
    })
    expect(sheet.getByText('Итого без НДС')).toBeInTheDocument()
    expect(sheet.getByText('НДС 16%')).toBeInTheDocument()
    expect(sheet.getByText('16 000 ₸')).toBeInTheDocument()
    expect(sheet.getByText('Итого с НДС')).toBeInTheDocument()
    // 100 000 + 16 000, and that is what is owed.
    expect(sheet.getAllByText('116 000 ₸').length).toBeGreaterThan(0)
  })
})

// ── §36 ────────────────────────────────────────────────────────────────────
//
// Asked from the desk: «почему один заезд надо отменять каждый день брони
// отдельно?» The bookings in question were separate ones — but they were
// separate because that is what the calendar made. Pressing the night after a
// stay booked that night on its own, so a guest staying on became two
// bookings: two closings, two invoices, two lines in every list.
//
// A stay that grows must stay one booking. The day offers it and applies
// nothing — the ordinary form opens with the dates already stretched.
describe('§36 ночь рядом с бронью предлагает продлить, а не заводить вторую', () => {
  const room = makeUnit({ id: 7, name: '107', status: 'free' })
  // Nights 14, 15 and 16 are taken: 14 → 17 in half-open dates.
  const AUGUST = {
    unit: { id: 7, name: '107', type: 'room' },
    month: '2026-08',
    days: Array.from({ length: 31 }, (_, i) => {
      const date = `2026-08-${String(i + 1).padStart(2, '0')}`
      const busy = i >= 13 && i <= 15
      return {
        date,
        status: busy ? 'booked' : 'free',
        booking_id: busy ? 512 : null,
        guest_name: busy ? 'Продлевающий Гость' : null,
      }
    }),
  }
  const STAY = {
    id: 512, unit_id: 7, guest_name: 'Продлевающий Гость', guest_phone: null,
    date_from: '2026-08-14', date_to: '2026-08-17', status: 'booked',
  }

  function routes(stay: unknown = STAY) {
    return {
      ...baseRoutes('admin', [room]),
      'GET /api/units/7': room,
      'GET /api/units/7/calendar': AUGUST,
      'GET /api/bookings': [stay],
    }
  }

  it('предлагает продлить, когда нажата ночь сразу после брони', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/7' })

    await userEvent.click(await screen.findByRole('button', { name: /17 авг.*свободно/ }))

    expect(await screen.findByRole('heading', { name: 'Гость остаётся ещё на ночь?' }))
      .toBeInTheDocument()
    expect(screen.getByText('Продлевающий Гость')).toBeInTheDocument()
    // Offered, not done: no request has gone anywhere yet.
    expect(screen.getByRole('button', { name: /Продлить до 18 авг/ })).toBeInTheDocument()
  })

  it('продление открывает ту же бронь с датой выезда на сутки дальше', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/7' })

    await userEvent.click(await screen.findByRole('button', { name: /17 авг.*свободно/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Продлить до 18 авг/ }))

    // The same booking — its number is in the heading — one night longer.
    expect(await screen.findByRole('heading', { name: 'Бронь #512' })).toBeInTheDocument()
    expect((screen.getByLabelText('Заезд') as HTMLInputElement).value).toBe('2026-08-14')
    expect((screen.getByLabelText('Выезд') as HTMLInputElement).value).toBe('2026-08-18')
  })

  it('ночь перед бронью предлагает передвинуть заезд, а не делать вторую', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/7' })

    await userEvent.click(await screen.findByRole('button', { name: /13 авг.*свободно/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Заезд с 13 авг/ }))

    expect(await screen.findByRole('heading', { name: 'Бронь #512' })).toBeInTheDocument()
    expect((screen.getByLabelText('Заезд') as HTMLInputElement).value).toBe('2026-08-13')
    expect((screen.getByLabelText('Выезд') as HTMLInputElement).value).toBe('2026-08-17')
  })

  it('вторая бронь всё равно доступна — это может быть другой гость', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/7' })

    await userEvent.click(await screen.findByRole('button', { name: /17 авг.*свободно/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Отдельная бронь' }))

    expect(await screen.findByRole('heading', { name: 'Новая бронь' })).toBeInTheDocument()
    expect((screen.getByLabelText('Заезд') as HTMLInputElement).value).toBe('2026-08-17')
  })

  it('ночь вдали от чужих броней открывает форму сразу, без вопроса', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/7' })

    await userEvent.click(await screen.findByRole('button', { name: /29 авг.*свободно/ }))

    expect(await screen.findByRole('heading', { name: 'Новая бронь' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /остаётся ещё на ночь/ })).toBeNull()
  })

  it('отменённую бронь продлевать не предлагает', async () => {
    signIn('admin')
    mockApi(routes({ ...STAY, status: 'free' }))
    renderApp(<App />, { route: '/rooms/7' })

    await userEvent.click(await screen.findByRole('button', { name: /17 авг.*свободно/ }))

    expect(await screen.findByRole('heading', { name: 'Новая бронь' })).toBeInTheDocument()
  })
})
