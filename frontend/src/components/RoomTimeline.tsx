import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { Alert, Spinner } from './ui'
import { addDaysIso, money, shortDate, todayIso } from '../format'
import { STATUS_LABELS } from '../types'
import type { RoomTimeline as Timeline, TimelineBooking, TimelineRoom } from '../types'

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const WEEK = 7
const MONTH = 30

/** Day-of-week from a YYYY-MM-DD string, read in UTC so it cannot shift. */
function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
]

/**
 * The window in words: «10 — 16 авг» or «10 авг — 8 сен».
 *
 * The month is written once when both ends share it, because "10 авг — 16 авг"
 * makes the reader compare two words to learn they are the same.
 */
export function rangeLabel(from: string, days: number): string {
  const [fy, fm, fd] = from.split('-').map(Number)
  const last = new Date(Date.UTC(fy, fm - 1, fd + days - 1))
  const lm = last.getUTCMonth()
  const ld = last.getUTCDate()

  return fm - 1 === lm
    ? `${fd} — ${ld} ${MONTHS_SHORT[lm]}`
    : `${fd} ${MONTHS_SHORT[fm - 1]} — ${ld} ${MONTHS_SHORT[lm]}`
}

/** Whole days between two YYYY-MM-DD strings. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

type Placed = {
  booking: TimelineBooking
  /** 0-based column within the window. */
  start: number
  span: number
  clippedStart: boolean
  clippedEnd: boolean
}

/**
 * Where a booking's bar sits in the visible window.
 *
 * A stay is counted in nights: 10→14 occupies the nights of the 10th, 11th,
 * 12th and 13th, and the room is free again on the 14th. So the end column is
 * exclusive — the checkout day is not shaded, which is what lets the next
 * guest's bar start there without the two appearing to overlap.
 */
function place(booking: TimelineBooking, from: string, days: number): Placed | null {
  const rawStart = daysBetween(from, booking.date_from.slice(0, 10))
  const rawEnd = daysBetween(from, booking.date_to.slice(0, 10))

  const start = Math.max(0, rawStart)
  const end = Math.min(days, rawEnd)
  if (end <= start) return null

  return { booking, start, span: end - start, clippedStart: rawStart < 0, clippedEnd: rawEnd > days }
}

/** Which day-columns a room is already taken on, as a set of indices. */
function occupiedNights(room: TimelineRoom, from: string, days: number): Set<number> {
  const taken = new Set<number>()
  for (const booking of room.bookings) {
    const bar = place(booking, from, days)
    if (!bar) continue
    for (let i = bar.start; i < bar.start + bar.span; i++) taken.add(i)
  }
  return taken
}

type Drag = { unitId: number; anchor: number; head: number }

type Popover = { room: TimelineRoom; booking: TimelineBooking }

/**
 * The planning board: rooms down the side, nights across the top.
 *
 * This is the screen the work actually happens on. A card grid answers "what
 * is room 107 doing right now"; the question asked on the phone is "have you
 * got anything for Friday to Sunday", and that is a shape — a run of nights
 * across a row — not a number on a card.
 *
 * Three things it has to do without making anyone hunt:
 *
 *   - Say how many rooms are free on each night, in the same columns as the
 *     rooms below, so the eye can drop straight from the number to the free
 *     rows. A separate availability strip elsewhere on the page cannot line
 *     up with anything and has to be read twice.
 *   - Let a stay be drawn rather than typed: press on the first night, drag
 *     to the last, release. A range that would collide with an existing
 *     booking refuses on release and says which nights are taken, rather
 *     than opening a form that the server will reject.
 *   - Open a booking in place. Clicking a bar shows who, when and what is
 *     owed, with the edit form one press away — the money rides along with
 *     the timeline data, so nothing is fetched to answer it.
 */
export default function RoomTimeline({
  onOpenRoom,
  onNewBooking,
  onEditBooking,
  reloadKey = 0,
}: {
  onOpenRoom: (unitId: number) => void
  /** Half-open, like the rest of the app: `to` is the checkout morning. */
  onNewBooking: (unitId: number, from: string, to: string) => void
  onEditBooking: (unitId: number, booking: TimelineBooking) => void
  /** Bumped by the page after a save, to pull fresh bars. */
  reloadKey?: number
}) {
  const [from, setFrom] = useState(todayIso())
  const [days, setDays] = useState(WEEK)
  const [data, setData] = useState<Timeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [drag, setDrag] = useState<Drag | null>(null)
  const [clash, setClash] = useState<string | null>(null)
  const [popover, setPopover] = useState<Popover | null>(null)
  const board = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api<Timeline>(`/rooms/timeline?from=${from}&days=${days}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [from, days])

  useEffect(load, [load, reloadKey])

  const today = todayIso()

  const columns = useMemo(
    () => ({ gridTemplateColumns: `var(--tl-name-w) repeat(${days}, var(--tl-day-w))` }),
    [days]
  )

  /**
   * Free rooms per night, counted from the same bars that are drawn below.
   * Deriving it here rather than from a separate endpoint means the header can
   * never disagree with the chart underneath it.
   */
  const freePerNight = useMemo(() => {
    if (!data) return []
    return data.dates.map((_, index) => {
      let free = 0
      for (const room of data.rooms) {
        if (!occupiedNights(room, data.from, data.days).has(index)) free++
      }
      return free
    })
  }, [data])

  /**
   * When "nearly full" starts. A share of the stock, not a fixed count: two
   * rooms left out of fourteen is worth flagging, two out of two is an empty
   * hotel.
   */
  const lowWater = useMemo(
    () => (data ? Math.max(1, Math.round(data.rooms.length * 0.2)) : 1),
    [data]
  )

  /** Nights already taken, per room, for collision checks while dragging. */
  const takenByRoom = useMemo(() => {
    const map = new Map<number, Set<number>>()
    if (data) {
      for (const room of data.rooms) {
        map.set(room.unit_id, occupiedNights(room, data.from, data.days))
      }
    }
    return map
  }, [data])

  // Memoised: the collision check and the commit effect both depend on it, and
  // a fresh object each render would re-run them on every render.
  const dragRange = useMemo(
    () =>
      drag ? { lo: Math.min(drag.anchor, drag.head), hi: Math.max(drag.anchor, drag.head) } : null,
    [drag]
  )

  /** Which nights in the current drag are already booked. */
  const dragCollisions = useMemo(() => {
    if (!drag || !dragRange) return []
    const taken = takenByRoom.get(drag.unitId)
    if (!taken) return []
    const hits: number[] = []
    for (let i = dragRange.lo; i <= dragRange.hi; i++) if (taken.has(i)) hits.push(i)
    return hits
  }, [drag, dragRange, takenByRoom])

  // A drag can end anywhere — off the grid, outside the window. Finishing it
  // on the window stops a half-made selection sticking to the cursor.
  useEffect(() => {
    if (!drag) return
    const commit = () => {
      setDrag(null)
      if (!data || !dragRange) return

      if (dragCollisions.length > 0) {
        const nights = dragCollisions.map((i) => shortDate(data.dates[i])).join(', ')
        setClash(`Эти ночи уже заняты: ${nights}. Выберите свободный промежуток.`)
        return
      }
      setClash(null)
      // The end date is the morning after the last night selected.
      onNewBooking(drag.unitId, data.dates[dragRange.lo], addDaysIso(data.dates[dragRange.hi], 1))
    }

    // A cancelled pointer is not a choice. On a phone the browser fires
    // pointercancel the moment a press turns into a scroll, and treating that
    // as a finished selection would open the booking form every time someone
    // scrolled the board.
    const abandon = () => setDrag(null)

    window.addEventListener('pointerup', commit)
    window.addEventListener('pointercancel', abandon)
    return () => {
      window.removeEventListener('pointerup', commit)
      window.removeEventListener('pointercancel', abandon)
    }
  }, [drag, dragRange, dragCollisions, data, onNewBooking])

  // Escape abandons a selection or closes the booking card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrag(null)
      setPopover(null)
      setClash(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!popover) return
    const onDown = (event: MouseEvent) => {
      if (!board.current?.contains(event.target as Node)) setPopover(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popover])

  const inDrag = (unitId: number, index: number) =>
    !!drag && drag.unitId === unitId && !!dragRange && index >= dragRange.lo && index <= dragRange.hi

  const nights = dragRange ? dragRange.hi - dragRange.lo + 1 : 0

  return (
    <section
      className={`panel glass timeline-panel ${days === MONTH ? 'is-month' : ''}`}
      ref={board}
    >
      <div className="timeline-bar">
        <div className="timeline-nav">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setFrom((f) => addDaysIso(f, -days))}
            aria-label="Предыдущий период"
          >
            ←
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setFrom(today)}>
            Сегодня
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setFrom((f) => addDaysIso(f, days))}
            aria-label="Следующий период"
          >
            →
          </button>
        </div>

        <label className="timeline-jump">
          <span>Перейти к дате</span>
          <input
            type="date"
            value={from}
            onChange={(event) => event.target.value && setFrom(event.target.value)}
          />
        </label>

        <div className="timeline-scale">
          <button
            className={`chip chip-sm ${days === WEEK ? 'active' : ''}`}
            onClick={() => setDays(WEEK)}
          >
            Неделя
          </button>
          <button
            className={`chip chip-sm ${days === MONTH ? 'active' : ''}`}
            onClick={() => setDays(MONTH)}
          >
            Месяц
          </button>
        </div>

        {/*
          The span, in words.

          On a phone the board can only ever show six or seven columns, so
          switching from a week to a month changed thirty columns behind a
          viewport that still displayed the same six days — the control looked
          broken because nothing on screen moved. This is the part that always
          moves.
        */}
        {data && (
          <div className="timeline-range" aria-live="polite">
            {rangeLabel(data.from, data.days)}
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {clash && (
        <div className="notice notice-warn timeline-clash">
          {clash}
          <button className="btn btn-sm btn-ghost" onClick={() => setClash(null)}>
            Понятно
          </button>
        </div>
      )}

      {loading && !data ? (
        <Spinner />
      ) : !data ? null : (
        <div className="timeline-scroll">
          {/* While a run is being drawn the bars stop swallowing the pointer,
              so the selection can extend across an occupied stretch and say
              in red why it will not be accepted. Without this the drag simply
              stops dead at the edge of a booking with no explanation. */}
          <div className={`timeline ${loading ? 'is-stale' : ''} ${drag ? 'is-dragging' : ''}`}>
            <div className="tl-row tl-head" style={columns}>
              <div className="tl-name tl-corner">Номер</div>
              {data.dates.map((date) => {
                const dow = weekdayIndex(date)
                return (
                  <div
                    key={date}
                    className={`tl-day ${dow === 0 || dow === 6 ? 'is-weekend' : ''} ${
                      date === today ? 'is-today' : ''
                    }`}
                  >
                    <span className="tl-day-num">{Number(date.slice(8, 10))}</span>
                    <span className="tl-day-dow">{DOW_SHORT[dow]}</span>
                  </div>
                )
              })}
            </div>

            {/* Availability, in the same columns as the rooms below it. */}
            <div className="tl-row tl-free-row" style={columns}>
              <div className="tl-name tl-free-label">Свободно</div>
              {freePerNight.map((free, index) => (
                <div
                  key={data.dates[index]}
                  className={`tl-free ${free === 0 ? 'is-none' : ''} ${
                    free > 0 && free <= lowWater ? 'is-low' : ''
                  }`}
                  title={`${data.dates[index]}: свободно ${free} из ${data.rooms.length}`}
                >
                  {free}
                </div>
              ))}
            </div>

            {data.rooms.map((room) => {
              const bars = room.bookings
                .map((booking) => place(booking, data.from, data.days))
                .filter((bar): bar is Placed => bar !== null)
              const taken = takenByRoom.get(room.unit_id) ?? new Set<number>()

              return (
                <div className="tl-row" key={room.unit_id} style={columns}>
                  <button
                    className="tl-name tl-room"
                    onClick={() => onOpenRoom(room.unit_id)}
                    title={`${room.category ?? '—'} · до ${room.capacity} чел.`}
                  >
                    {room.unit_name}
                  </button>

                  {data.dates.map((date, index) => {
                    const dow = weekdayIndex(date)
                    const selected = inDrag(room.unit_id, index)
                    const bad = selected && taken.has(index)
                    return (
                      <button
                        key={date}
                        className={`tl-cell ${dow === 0 || dow === 6 ? 'is-weekend' : ''} ${
                          date === today ? 'is-today' : ''
                        } ${selected ? 'is-selected' : ''} ${bad ? 'is-clash' : ''}`}
                        style={{ gridColumn: index + 2, gridRow: 1 }}
                        onPointerDown={(event) => {
                          // Only the mouse gets its default suppressed: doing
                          // it for touch would stop the board scrolling.
                          if (event.pointerType === 'mouse') event.preventDefault()
                          setClash(null)
                          setPopover(null)
                          setDrag({ unitId: room.unit_id, anchor: index, head: index })
                        }}
                        onPointerEnter={() =>
                          setDrag((d) => (d && d.unitId === room.unit_id ? { ...d, head: index } : d))
                        }
                        title={`${room.unit_name} · ${shortDate(date)} — свободно`}
                        aria-label={`Забронировать номер ${room.unit_name} с ${date}`}
                      />
                    )
                  })}

                  {bars.map((bar) => (
                    <button
                      key={bar.booking.id}
                      className={`tl-bar ${bar.clippedStart ? 'clip-start' : ''} ${
                        bar.clippedEnd ? 'clip-end' : ''
                      } ${popover?.booking.id === bar.booking.id ? 'is-open' : ''}`}
                      data-status={bar.booking.status}
                      style={{ gridColumn: `${bar.start + 2} / span ${bar.span}`, gridRow: 1 }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        setClash(null)
                        setPopover((open) =>
                          open?.booking.id === bar.booking.id ? null : { room, booking: bar.booking }
                        )
                      }}
                      title={`${bar.booking.guest_name ?? 'Без имени'} · ${shortDate(
                        bar.booking.date_from
                      )} — ${shortDate(bar.booking.date_to)}`}
                    >
                      <span className="tl-bar-label">{bar.booking.guest_name ?? 'Бронь'}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* While dragging, say what is being chosen — a selection you cannot
          read is a selection you have to redo. */}
      {drag && dragRange && data && (
        <div className={`timeline-selection ${dragCollisions.length > 0 ? 'is-clash' : ''}`}>
          {dragCollisions.length > 0
            ? 'Промежуток пересекается с существующей бронью'
            : `${shortDate(data.dates[dragRange.lo])} — ${shortDate(
                addDaysIso(data.dates[dragRange.hi], 1)
              )} · ${nights} ${nights === 1 ? 'ночь' : nights < 5 ? 'ночи' : 'ночей'}`}
        </div>
      )}

      {popover && (
        <div className="tl-popover glass" role="dialog" aria-label="Бронь">
          <div className="tl-popover-head">
            <div>
              <div className="tl-popover-guest">{popover.booking.guest_name ?? 'Без имени'}</div>
              <div className="tl-popover-sub">
                {popover.room.unit_name} · {shortDate(popover.booking.date_from)} —{' '}
                {shortDate(popover.booking.date_to)}
              </div>
            </div>
            <button
              className="alert-dismiss"
              onClick={() => setPopover(null)}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>

          <div className="tl-popover-rows">
            <div className="info-row">
              <span>Статус</span>
              <span>{STATUS_LABELS[popover.booking.status]}</span>
            </div>
            {popover.booking.guest_phone && (
              <div className="info-row">
                <span>Телефон</span>
                <span>{popover.booking.guest_phone}</span>
              </div>
            )}
            <div className="info-row">
              <span>Начислено</span>
              <span>
                {money(
                  popover.booking.total_amount + popover.booking.charges_amount,
                  popover.booking.currency
                )}
              </span>
            </div>
            <div className="info-row">
              <span>{popover.booking.remaining_amount > 0 ? 'Остаток' : 'Оплачено'}</span>
              <span className={popover.booking.remaining_amount > 0 ? 'money-due' : undefined}>
                {money(
                  Math.abs(popover.booking.remaining_amount),
                  popover.booking.currency
                )}
              </span>
            </div>
          </div>

          <div className="tl-popover-actions">
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const { room, booking } = popover
                setPopover(null)
                onEditBooking(room.unit_id, booking)
              }}
            >
              Изменить бронь
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                const unitId = popover.room.unit_id
                setPopover(null)
                onOpenRoom(unitId)
              }}
            >
              Открыть номер
            </button>
          </div>
        </div>
      )}

      <div className="field-hint timeline-hint">
        Протяните по свободным ночам, чтобы создать бронь на этот промежуток; одно нажатие — одна
        ночь. Нажмите на полосу, чтобы посмотреть или изменить бронь. Выезд утром, поэтому день
        выезда уже свободен для следующего гостя.
      </div>
    </section>
  )
}
