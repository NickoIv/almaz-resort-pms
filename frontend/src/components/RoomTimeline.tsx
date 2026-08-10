import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { Alert, Spinner } from './ui'
import { addDaysIso, daysBetween, money, percent, pluralRu, shortDate, todayIso } from '../format'
import { STATUS_LABELS } from '../types'
import type {
  RoomTimeline as Timeline,
  RoomYear,
  TimelineBooking,
  TimelineRoom,
} from '../types'

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const WEEK = 7

/**
 * What the board is showing.
 *
 * «Месяц» is a **calendar** month, from the 1st to the last day, and not a
 * rolling thirty days — thirty days came up short in every 31-day month, so the
 * whole of August could not be seen at all.
 *
 * «Год» is a different chart, not a longer one. 365 day-columns would be
 * ~17 000px of horizontal scrolling on a board where a phone shows six columns;
 * the question at that range is which months are filling up, and that fits on
 * one screen in twelve.
 */
type Scale = 'week' | 'month' | 'year'

const SCALES: [Scale, string][] = [
  ['week', 'Неделя'],
  ['month', 'Месяц'],
  ['year', 'Год'],
]

/** Day-of-week from a YYYY-MM-DD string, read in UTC so it cannot shift. */
function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Days in a 1-based month, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The 1st of the month `iso` falls in. */
function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** The 1st of the month `delta` months away from the one `iso` falls in. */
function shiftMonth(iso: string, delta: number): string {
  const [year, month] = iso.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return shifted.toISOString().slice(0, 10)
}

/**
 * How full a month reads at a glance, in four steps rather than a gradient.
 *
 * A continuous shade would need the reader to compare two cells to tell 60%
 * from 70%, which is not a question anyone asks of a year chart. The steps are
 * the answers people act on: nothing yet, filling, busy, effectively sold out.
 */
function fillLevel(sold: number, total: number): 'none' | 'low' | 'mid' | 'high' | 'full' {
  if (sold <= 0) return 'none'
  const ratio = sold / total
  if (ratio >= 0.95) return 'full'
  if (ratio >= 0.67) return 'high'
  if (ratio >= 0.34) return 'mid'
  return 'low'
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
  onPrintBooking,
  reloadKey = 0,
}: {
  onOpenRoom: (unitId: number) => void
  /**
   * Half-open, like the rest of the app: `to` is the checkout morning. The room
   * name travels with the id because the board already has it — the page would
   * otherwise have to find it in a separate fetch that may not have landed.
   */
  onNewBooking: (unitId: number, from: string, to: string, unitName: string) => void
  onEditBooking: (unitId: number, booking: TimelineBooking, unitName: string) => void
  /**
   * A bar is the one place in the app where any booking can be picked, not just
   * the one a unit happens to be running today — which is what makes it the way
   * in to printing an arbitrary booking's confirmation.
   */
  onPrintBooking: (booking: TimelineBooking, unitName: string) => void
  /** Bumped by the page after a save, to pull fresh bars. */
  reloadKey?: number
}) {
  const [scale, setScale] = useState<Scale>('week')
  const [from, setFrom] = useState(todayIso())
  const [data, setData] = useState<Timeline | null>(null)
  const [year, setYear] = useState<RoomYear | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * The window the day views ask for. A calendar month starts on the 1st and
   * runs to the last day, so both the start and the length follow from the scale
   * rather than being set alongside it and drifting apart.
   */
  const windowStart = scale === 'month' ? monthStart(from) : from
  const days =
    scale === 'month'
      ? daysInMonth(Number(windowStart.slice(0, 4)), Number(windowStart.slice(5, 7)))
      : WEEK

  const [drag, setDrag] = useState<Drag | null>(null)
  const [clash, setClash] = useState<string | null>(null)
  const [popover, setPopover] = useState<Popover | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    // The year is a different endpoint, not a longer window: it answers in
    // nights-per-month, which is the only shape that fits twelve columns.
    const request =
      scale === 'year'
        ? api<RoomYear>(`/rooms/year?year=${from.slice(0, 4)}`).then(setYear)
        : api<Timeline>(`/rooms/timeline?from=${windowStart}&days=${days}`).then(setData)

    request
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [scale, windowStart, days, from])

  useEffect(load, [load, reloadKey])

  const today = todayIso()

  /**
   * Bring today into view once the window that contains it has loaded.
   *
   * A calendar month starts on the 1st, and the board only ever shows six or
   * seven columns on a phone — so pressing «Месяц» on the 20th opened on the
   * 1st and left the reader looking at three weeks that had already happened,
   * with today somewhere off the right edge. The month is still the whole month;
   * this only decides which part of it the scroller is parked on.
   *
   * Geometry rather than `offsetLeft`, which is measured against the nearest
   * positioned ancestor and would be wrong the moment one appears; and
   * `scrollLeft` rather than `scrollIntoView`, which would also scroll the page.
   */
  useEffect(() => {
    if (scale === 'year' || !data) return
    const box = scroller.current
    if (!box) return
    if (!data.dates.includes(today)) return

    const cell = box.querySelector('.tl-head .tl-day.is-today')
    if (!cell) return

    // A third of a screen in from the left, so the days just before today stay
    // visible — they are the context that makes "today" mean anything.
    const offset =
      cell.getBoundingClientRect().left - box.getBoundingClientRect().left - box.clientWidth / 3
    box.scrollLeft = Math.max(0, box.scrollLeft + offset)
  }, [data, scale, today])

  /** Move the anchor by one of whatever is currently on screen. */
  const step = useCallback(
    (iso: string, direction: number): string => {
      if (scale === 'week') return addDaysIso(iso, direction * WEEK)
      if (scale === 'month') return shiftMonth(iso, direction)
      return `${Number(iso.slice(0, 4)) + direction}${iso.slice(4)}`
    },
    [scale]
  )

  const columns = useMemo(
    () => ({ gridTemplateColumns: `var(--tl-name-w) repeat(${days}, var(--tl-day-w))` }),
    [days]
  )

  /**
   * Twelve columns that share whatever width there is, rather than the fixed
   * day width the other scales scroll through — a year that scrolled like the
   * day board would be the thing this view exists to avoid.
   *
   * The 40px floor is a tap target, not a look: a month cell is a button that
   * opens that month, and at 390px twelve free-sharing columns came out 20px
   * wide — half the size the mobile audit treats as a failure. It is 40 rather
   * than 36 because the cell carries 2px of gutter, so a 36px track would leave
   * a 34px button and fail the very threshold it was set to clear.
   *
   * With the floor a phone scrolls the year by about half a screen — nothing
   * like the 4× the day board scrolls, and the whole year is one thumb movement
   * away rather than twelve.
   */
  const yearColumns = useMemo(
    () => ({ gridTemplateColumns: 'var(--tl-name-w) repeat(12, minmax(40px, 1fr))' }),
    []
  )

  /** Occupancy across the whole year, for the label above the chart. */
  const yearOccupancy = useMemo(() => {
    if (!year) return 0
    const sold = year.months.reduce((sum, month) => sum + month.nights_sold, 0)
    const available = year.months.reduce((sum, month) => sum + month.nights_available, 0)
    return available > 0 ? sold / available : 0
  }, [year])

  const lowWaterYear = useMemo(
    () => (year ? Math.max(1, Math.round(year.rooms_total * 0.2)) : 1),
    [year]
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
      onNewBooking(
        drag.unitId,
        data.dates[dragRange.lo],
        addDaysIso(data.dates[dragRange.hi], 1),
        data.rooms.find((room) => room.unit_id === drag.unitId)?.unit_name ?? ''
      )
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

  // The panel carries the scale as `data-scale`. An `is-month` class used to
  // hang here that no stylesheet or test ever read — a leftover hook from the
  // column-density experiment that was reverted.
  return (
    <section className="panel glass timeline-panel" data-scale={scale} ref={board}>
      <div className="timeline-bar">
        {/* One step is one of whatever is on screen: a week, a whole month, a
            year. Stepping a month view by thirty days would land it mid-month
            and stop it being a calendar month at all. */}
        <div className="timeline-nav">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setFrom((f) => step(f, -1))}
            aria-label="Предыдущий период"
          >
            ←
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setFrom(today)}>
            Сегодня
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setFrom((f) => step(f, 1))}
            aria-label="Следующий период"
          >
            →
          </button>
        </div>

        {scale !== 'year' && (
          <label className="timeline-jump">
            <span>Перейти к дате</span>
            <input
              type="date"
              value={from}
              onChange={(event) => event.target.value && setFrom(event.target.value)}
            />
          </label>
        )}

        <div className="timeline-scale">
          {SCALES.map(([key, label]) => (
            <button
              key={key}
              className={`chip chip-sm ${scale === key ? 'active' : ''}`}
              onClick={() => setScale(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/*
          The span, in words.

          On a phone the board can only ever show six or seven columns, so
          switching from a week to a month changed thirty columns behind a
          viewport that still displayed the same six days — the control looked
          broken because nothing on screen moved. This is the part that always
          moves.
        */}
        {scale === 'year'
          ? year && (
              <div className="timeline-range" aria-live="polite">
                {/* A decimal below 1%: a flat "0%" beside cells that visibly
                    hold numbers reads as the figure being broken rather than
                    as a year that has barely been sold yet. */}
                {year.year} · занято{' '}
                {yearOccupancy > 0 && yearOccupancy < 0.01
                  ? percent(yearOccupancy, 1)
                  : percent(yearOccupancy)}
              </div>
            )
          : data && (
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

      {scale === 'year' ? (
        loading && !year ? (
          <Spinner />
        ) : !year ? null : (
          /* No drag: a month is not a night, and there is nothing here that
             could be booked by pressing on it. Pressing opens the month in
             days, where booking lives. The scroll wrapper only ever engages on
             a narrow phone, where the cells hit their 36px floor. */
          <>
            <div className="timeline-scroll">
              <div className={`timeline timeline-year ${loading ? 'is-stale' : ''}`}>
            <div className="tl-row tl-head" style={yearColumns}>
              <div className="tl-name tl-corner">Номер</div>
              {year.months.map((month) => (
                <div
                  key={month.month}
                  className={`tl-day ${month.month === today.slice(0, 7) ? 'is-today' : ''}`}
                >
                  <span className="tl-day-num">{MONTHS_SHORT[Number(month.month.slice(5, 7)) - 1]}</span>
                  <span className="tl-day-dow">{month.nights_total}</span>
                </div>
              ))}
            </div>

            <div className="tl-row tl-free-row" style={yearColumns}>
              <div className="tl-name tl-free-label">Свободно</div>
              {year.months.map((month) => (
                <div
                  key={month.month}
                  className={`tl-free ${month.rooms_free === 0 ? 'is-none' : ''} ${
                    month.rooms_free > 0 && month.rooms_free <= lowWaterYear ? 'is-low' : ''
                  }`}
                  title={`${month.month}: ни одной ночи не продано в ${month.rooms_free} из ${year.rooms_total} номеров · загрузка ${percent(month.occupancy_rate)}`}
                >
                  {month.rooms_free}
                </div>
              ))}
            </div>

            {year.rooms.map((room) => (
              <div className="tl-row" key={room.unit_id} style={yearColumns}>
                <button
                  className="tl-name tl-room"
                  onClick={() => onOpenRoom(room.unit_id)}
                  title={`${room.category ?? '—'} · до ${room.capacity} чел.`}
                >
                  {room.unit_name}
                </button>
                {room.months.map((month) => (
                  <button
                    key={month.month}
                    className="tl-month"
                    data-fill={fillLevel(month.nights_sold, month.nights_total)}
                    onClick={() => {
                      setFrom(`${month.month}-01`)
                      setScale('month')
                    }}
                    title={`${room.unit_name}, ${month.month}: занято ${month.nights_sold} из ${month.nights_total} ${pluralRu(month.nights_total, ['ночи', 'ночей', 'ночей'])} — открыть месяц`}
                  >
                    {month.nights_sold > 0 ? month.nights_sold : ''}
                  </button>
                ))}
              </div>
            ))}

              </div>
            </div>
            {/* Outside the scroller: it is prose about the chart, and prose
                that slides sideways with the grid is prose nobody finishes. */}
            <div className="timeline-hint">
              Число в клетке — сколько ночей продано за месяц. Нажмите на месяц,
              чтобы открыть его по дням и забронировать.
            </div>
          </>
        )
      ) : loading && !data ? (
        <Spinner />
      ) : !data ? null : (
        <div className="timeline-scroll" ref={scroller}>
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
              )} · ${nights} ${pluralRu(nights, ['ночь', 'ночи', 'ночей'])}`}
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
                onEditBooking(room.unit_id, booking, room.unit_name)
              }}
            >
              Изменить бронь
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                const { room, booking } = popover
                setPopover(null)
                onPrintBooking(booking, room.unit_name)
              }}
            >
              Печать инвойса
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

      {/* Instructions for dragging nights, which the year view has none of —
          telling someone to drag across a month is telling them to do
          something that will not work. */}
      {scale !== 'year' && (
        <div className="field-hint timeline-hint">
          Протяните по свободным ночам, чтобы создать бронь на этот промежуток; одно нажатие — одна
          ночь. Нажмите на полосу, чтобы посмотреть или изменить бронь. Выезд утром, поэтому день
          выезда уже свободен для следующего гостя.
        </div>
      )}
    </section>
  )
}
