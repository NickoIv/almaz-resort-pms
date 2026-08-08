import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeUnit, mockApi, renderApp, signIn, STAFF } from './test-utils'

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
    mockApi(baseRoutes('admin'))
    renderApp(<App />, { route: '/rooms' })
    expect(await screen.findByText('Асель Жумабаева')).toBeInTheDocument()
  })

  it('renders names containing backslashes and angle brackets verbatim', async () => {
    signIn('admin')
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
    mockApi(baseRoutes('admin', rooms))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /105/ })
    await userEvent.type(screen.getByRole('searchbox'), 'Тимур')

    expect(screen.getByRole('button', { name: /107/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /105/ })).not.toBeInTheDocument()
  })

  it('filters by phone typed without punctuation', async () => {
    signIn('admin')
    mockApi(baseRoutes('admin', rooms))
    renderApp(<App />, { route: '/rooms' })

    await screen.findByRole('button', { name: /105/ })
    await userEvent.type(screen.getByRole('searchbox'), '77073148820')

    expect(screen.getByRole('button', { name: /105/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /107/ })).not.toBeInTheDocument()
  })

  it('filters by status', async () => {
    signIn('admin')
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

describe('§4 check-out receipt', () => {
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
        text: { hotel_name: 'Almaz Resort', hotel_details: 'Алматы, ул. Пример 1' },
      },
    }
  }

  it('itemises the rate, each charge, totals, and keeps the deposit separate', async () => {
    signIn('admin')
    mockApi(routes())
    renderApp(<App />, { route: '/rooms/5' })

    await userEvent.click(await screen.findByRole('button', { name: 'Печать чека' }))
    const receipt = await screen.findByText(/Счёт-акт по брони №42/)
    const sheet = receipt.closest('.print-sheet')!
    const q = within(sheet as HTMLElement)

    // Hotel identity comes from settings, not a hard-coded string.
    expect(q.getByText('Almaz Resort')).toBeInTheDocument()
    expect(q.getByText('Алматы, ул. Пример 1')).toBeInTheDocument()

    // Guest and stay.
    expect(q.getByText('Асель Жумабаева')).toBeInTheDocument()
    expect(q.getByText('+7 707 314 88 20')).toBeInTheDocument()

    // Line items: rate plus each charge by its reason.
    expect(q.getByText('Проживание')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Печать чека' })).not.toBeInTheDocument()
  })
})

describe('§10 review profile links', () => {
  const withUrls = (urls: Partial<Record<string, string>>) => ({
    notifications: {}, channel: 'whatsapp', whatsapp_configured: false, telegram_configured: false,
    text: {
      hotel_name: 'Almaz Resort', hotel_details: '',
      reviews_2gis_url: '', reviews_google_url: '', ...urls,
    },
  })

  it('shows a link for each configured profile', async () => {
    signIn('admin')
    mockApi({
      ...baseRoutes('admin'),
      'GET /api/settings': withUrls({
        reviews_2gis_url: 'https://2gis.kz/almaty/firm/123',
        reviews_google_url: 'https://g.page/almaz',
      }),
    })
    renderApp(<App />, { route: '/rooms' })

    expect(await screen.findByText('Отзывы')).toBeInTheDocument()
    const twoGis = screen.getByRole('link', { name: '2ГИС' })
    expect(twoGis).toHaveAttribute('href', 'https://2gis.kz/almaty/firm/123')
    // Opened without leaking the PMS URL to the review site.
    expect(twoGis).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(screen.getByRole('link', { name: 'Google' })).toHaveAttribute('href', 'https://g.page/almaz')
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
                         'Аналитика', 'Журнал', 'Персонал', 'Настройки']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('drops a group whose every item the role cannot see', async () => {
    signIn('housekeeper')
    mockApi(baseRoutes('housekeeper'))
    renderApp(<App />, { route: '/cleaning' })

    const nav = await screen.findByRole('navigation', { name: 'Разделы' })
    expect(within(nav).getByText('Работа')).toBeInTheDocument()
    // No reports and no management items are allowed, so neither heading shows.
    expect(within(nav).queryByText('Отчёты')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Управление')).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Уборка' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Номера' })).not.toBeInTheDocument()
  })

  it('lands the admin on a dashboard of summary tiles', async () => {
    signIn('admin')
    mockApi(DASH_ROUTES)
    renderApp(<App />, { route: '/' })

    expect(await screen.findByRole('heading', { name: 'Сводка' })).toBeInTheDocument()

    // One of two units is an occupied room; the gazebo is not counted as a room.
    const occupancy = screen.getByText('Занято номеров').closest('.tile')!
    expect(within(occupancy as HTMLElement).getByText('1')).toBeInTheDocument()
    expect(within(occupancy as HTMLElement).getByText(/из 1/)).toBeInTheDocument()

    const waitlist = screen.getByText('Лист ожидания').closest('.tile')!
    expect(within(waitlist as HTMLElement).getByText('3')).toBeInTheDocument()

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
    expect(tiles.map((tile) => tile.getAttribute('href'))).toEqual([
      '/rooms', '/cleaning', '/rooms', '/waitlist',
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

  it('still renders the log when a tile endpoint fails', async () => {
    signIn('admin')
    mockApi({ ...DASH_ROUTES, 'GET /api/waitlist/summary': () => { throw new Error('down') } })
    renderApp(<App />, { route: '/' })

    // The waitlist tile degrades to zero rather than blanking the page.
    expect(await screen.findByRole('heading', { name: 'Сводка' })).toBeInTheDocument()
    expect(screen.getByText('Занято номеров')).toBeInTheDocument()
  })
})
