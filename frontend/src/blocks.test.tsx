import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoomTimeline from './components/RoomTimeline'
import MonthCalendar from './components/MonthCalendar'
import UnitCard from './components/UnitCard'
import { describeAudit, type AuditEntry } from './audit'
import { makeUnit, mockApi, renderApp, signIn, STAFF } from './test-utils'
import type { CalendarDay } from './types'

/**
 * §39 — объект, снятый с продажи.
 *
 * Before this existed the only way to stop selling a room for three days was to
 * write a fake booking on a guest called «Ремонт». That is not a workaround, it
 * is data corruption with a friendly name — and the tests that matter are not
 * "can a block be saved" (smoke-blocks.mjs proves that against a real Worker,
 * 30 checks) but "does the screen stop offering the room, and does it say why".
 *
 * The rule these all come back to: a block is **not** a stay. It must not look
 * like one, must not be counted like one, and must not be pressable like one.
 */

const DATES = ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12']

function timeline(blocks: unknown[]) {
  return {
    from: DATES[0],
    days: 4,
    max_days: 31,
    dates: DATES,
    rooms: [
      { unit_id: 5, unit_name: '101', category: 'standard', capacity: 2, bookings: [], blocks },
      { unit_id: 6, unit_name: '104', category: 'standard', capacity: 2, bookings: [], blocks: [] },
    ],
  }
}

const BLOCK = {
  id: 1,
  date_from: '2026-08-10',
  date_to: '2026-08-12',
  reason: 'repair',
  note: 'меняем смеситель',
}

function board(blocks: unknown[] = [BLOCK]) {
  mockApi({
    'GET /api/auth/me': { user: STAFF.admin },
    'GET /api/rooms/timeline': timeline(blocks),
  })
  signIn('admin')
  return renderApp(
    <RoomTimeline
      onOpenRoom={vi.fn()}
      onNewBooking={vi.fn()}
      onEditBooking={vi.fn()}
      onPrintBooking={vi.fn()}
      onTransferBooking={vi.fn()}
    />
  )
}

/** The «Свободно» header for each night, as the board prints it. */
function freeRow(): string[] {
  const row = document.querySelector('.tl-free-row')!
  return [...row.querySelectorAll('.tl-free')].map((cell) => cell.textContent!.trim())
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('§39 доска не предлагает то, что нельзя продать', () => {
  it('снятые ночи нельзя нажать, и они говорят, почему', async () => {
    board()
    await screen.findByText('101')

    // Half-open, like everything else: 10→12 is the nights of the 10th and the
    // 11th, and the room is sellable again on the morning of the 12th.
    const blocked = document.querySelectorAll('.tl-cell.is-blocked')
    await waitFor(() => expect(blocked.length).toBeGreaterThan(0))
    expect(document.querySelectorAll('.tl-cell.is-blocked').length).toBe(2)

    // A `div`, not a disabled button: there is nothing to press, and a disabled
    // control still invites the press that will do nothing.
    for (const cell of document.querySelectorAll('.tl-cell.is-blocked')) {
      expect(cell.tagName).toBe('DIV')
      expect(cell.getAttribute('title')).toContain('снят с продажи')
      expect(cell.getAttribute('title')).toContain('ремонт')
    }
    // The note travels: "why is 101 out" is answered on the board itself.
    expect(document.querySelector('.tl-cell.is-blocked')!.getAttribute('title'))
      .toContain('меняем смеситель')
  })

  it('и не считает их свободными в строке «Свободно»', async () => {
    board()
    await screen.findByText('101')

    // Two rooms. On the 10th and 11th one of them is off sale, so the answer to
    // "сколько свободно" is one — this is the line the desk reads while
    // answering the phone, and it is the one that must never over-promise.
    await waitFor(() => expect(freeRow()).toEqual(['2', '1', '1', '2']))
  })

  it('без снятий строка «Свободно» считает по-старому', async () => {
    board([])
    await screen.findByText('101')
    await waitFor(() => expect(freeRow()).toEqual(['2', '2', '2', '2']))
    expect(document.querySelectorAll('.tl-cell.is-blocked').length).toBe(0)
  })
})

describe('§39 месяц объекта тоже перестаёт предлагать эти дни', () => {
  const days: CalendarDay[] = [
    { date: '2026-08-10', status: 'free', booking_id: null, guest_name: null },
    {
      date: '2026-08-11', status: 'free', booking_id: null, guest_name: null,
      blocked: { id: 1, reason: 'repair', note: null },
    },
  ]

  it('снятый день не кнопка — форму, которую сервер откажет, открывать нечем', () => {
    renderApp(<MonthCalendar days={days} onSelect={vi.fn()} />)

    const free = screen.getByLabelText(/10 авг.*свободно/)
    expect(free.tagName).toBe('BUTTON')

    const blocked = document.querySelector('.cal-day.is-blocked')!
    expect(blocked.tagName).toBe('DIV')
    expect(blocked.getAttribute('title')).toContain('снят с продажи')
    // The number stays: this grid is read by counting along to a date.
    expect(blocked.textContent).toBe('11')
  })
})

describe('§39 карточка отвечает на вопрос, ради которого её смотрят', () => {
  it('говорит «снят с продажи» там, где был бы гость', () => {
    renderApp(
      <UnitCard
        unit={makeUnit({
          id: 5,
          name: '101',
          status: 'free',
          block: { id: 1, date_from: '2026-08-10', date_to: '2026-08-12', reason: 'repair', note: null },
        })}
        onOpen={vi.fn()}
      />
    )

    // «Нет брони» there would be true and useless: the card is scanned to
    // answer "can I sell this tonight", and the answer is no.
    expect(screen.getByText('Снят с продажи')).toBeTruthy()
    expect(screen.queryByText('Нет брони')).toBeNull()
    expect(screen.getByText(/ремонт/)).toBeTruthy()
  })
})

describe('§39 журнал читается без похода в базу', () => {
  it('называет объект и причину, потому что записи о снятии может уже не быть', () => {
    const entry = (action: string) =>
      ({
        id: 1, staff_user_id: 1, staff_name: 'Нурлан', staff_role: 'admin',
        action, entity: 'unit_blocks', entity_id: 7,
        created_at: '2026-08-11 10:00', target: null, guest_name: null,
      }) as AuditEntry

    expect(describeAudit(entry('block.create:repair:101'))).toBe('Снят с продажи: 101 — ремонт')
    // Deleting a block removes the row, so the name has to be in the action or
    // the journal entry points at nothing at all.
    expect(describeAudit(entry('block.delete:101'))).toBe('Вернули в продажу: 101')
  })
})
