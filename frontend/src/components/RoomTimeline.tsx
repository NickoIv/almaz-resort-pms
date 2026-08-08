import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Alert, Spinner } from './ui'
import { addDaysIso, shortDate, todayIso } from '../format'
import type { RoomTimeline as Timeline, TimelineBooking } from '../types'

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const WEEK = 7
const MONTH = 30

/** Day-of-week from a YYYY-MM-DD string, read in UTC so it cannot shift. */
function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
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
 *
 * Returns null when nothing of the booking falls inside the window.
 */
function place(booking: TimelineBooking, from: string, days: number): Placed | null {
  const rawStart = daysBetween(from, booking.date_from.slice(0, 10))
  const rawEnd = daysBetween(from, booking.date_to.slice(0, 10))

  const start = Math.max(0, rawStart)
  const end = Math.min(days, rawEnd)
  if (end <= start) return null

  return {
    booking,
    start,
    span: end - start,
    clippedStart: rawStart < 0,
    clippedEnd: rawEnd > days,
  }
}

/**
 * Rooms down the side, days across the top.
 *
 * A card grid answers "what is room 107 doing right now"; this answers "what
 * is free next Friday", which is the question asked on the phone. Bookings are
 * drawn as one bar across their whole range rather than a shaded cell per day,
 * so a five-night stay reads as one stay.
 *
 * It shows availability; it does not constrain it. Booking dates outside the
 * visible window still works through the ordinary form — the window is only
 * what you are looking at.
 */
export default function RoomTimeline({
  onOpenRoom,
  onNewBooking,
}: {
  onOpenRoom: (unitId: number) => void
  onNewBooking: (unitId: number, date: string) => void
}) {
  const [from, setFrom] = useState(todayIso())
  const [days, setDays] = useState(WEEK)
  const [data, setData] = useState<Timeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api<Timeline>(`/rooms/timeline?from=${from}&days=${days}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [from, days])

  useEffect(load, [load])

  const today = todayIso()

  // Keeps the grid and every row in step: one name column plus one per day.
  const columns = useMemo(
    () => ({ gridTemplateColumns: `var(--tl-name-w) repeat(${days}, var(--tl-day-w))` }),
    [days]
  )

  return (
    <section className="panel glass timeline-panel">
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
      </div>

      {error && <Alert>{error}</Alert>}

      {loading && !data ? (
        <Spinner />
      ) : !data ? null : (
        <div className="timeline-scroll">
          <div className={`timeline ${loading ? 'is-stale' : ''}`}>
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

            {data.rooms.map((room) => {
              const bars = room.bookings
                .map((booking) => place(booking, data.from, data.days))
                .filter((bar): bar is Placed => bar !== null)

              return (
                <div className="tl-row" key={room.unit_id} style={columns}>
                  <button
                    className="tl-name tl-room"
                    onClick={() => onOpenRoom(room.unit_id)}
                    title={`${room.category ?? '—'} · до ${room.capacity} чел.`}
                  >
                    {room.unit_name}
                  </button>

                  {/* The empty cells sit underneath; a bar placed in the same
                      grid area covers whichever ones it spans. */}
                  {data.dates.map((date, index) => {
                    const dow = weekdayIndex(date)
                    return (
                      <button
                        key={date}
                        className={`tl-cell ${dow === 0 || dow === 6 ? 'is-weekend' : ''} ${
                          date === today ? 'is-today' : ''
                        }`}
                        style={{ gridColumn: index + 2, gridRow: 1 }}
                        onClick={() => onNewBooking(room.unit_id, date)}
                        title={`${room.unit_name} · ${shortDate(date)} — свободно, забронировать`}
                        aria-label={`Забронировать номер ${room.unit_name} на ${date}`}
                      />
                    )
                  })}

                  {bars.map((bar) => (
                    <button
                      key={bar.booking.id}
                      className={`tl-bar ${bar.clippedStart ? 'clip-start' : ''} ${
                        bar.clippedEnd ? 'clip-end' : ''
                      }`}
                      data-status={bar.booking.status}
                      style={{
                        gridColumn: `${bar.start + 2} / span ${bar.span}`,
                        gridRow: 1,
                      }}
                      onClick={() => onOpenRoom(room.unit_id)}
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

      <div className="field-hint timeline-hint">
        Пустая клетка — номер свободен в эту ночь; нажмите, чтобы создать бронь на эту дату.
        Полоса — бронь целиком, нажмите, чтобы открыть номер. Выезд происходит утром, поэтому день
        выезда уже свободен.
      </div>
    </section>
  )
}
