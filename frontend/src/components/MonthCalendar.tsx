import type { CalendarDay } from '../types'
import { blockReasonWord } from '../blocks'
import { shortDate, todayIso } from '../format'

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/**
 * Monday-based column index for a YYYY-MM-DD string. Computed in UTC so the
 * grid does not shift a column depending on where the viewer is.
 */
function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

/**
 * A month of one unit, and — when `onSelect` is given — a way into each day.
 *
 * The board has always let a night be pressed: drag a free run to book it, tap
 * a bar to open the stay. This grid showed the same information and did
 * nothing, so the answer to "what is this booking on the 9th?" was to go back
 * to the board and find it there.
 *
 * Each day is a real `<button>` when it is pressable rather than a `div` with
 * a role: keyboard focus, Enter and Space come free that way, and every other
 * pressable cell in this app is a button already.
 */
export default function MonthCalendar({
  days,
  onSelect,
}: {
  days: CalendarDay[] | undefined
  onSelect?: (day: CalendarDay) => void
}) {
  // Defensive: a malformed or partial response must not take the page down.
  if (!Array.isArray(days) || days.length === 0) return null

  const leadingBlanks = weekdayIndex(days[0].date)
  const today = todayIso()

  /** Said in full for a screen reader, which cannot see the colour. */
  const label = (day: CalendarDay) =>
    day.blocked
      ? `${shortDate(day.date)} — снят с продажи (${blockReasonWord(day.blocked.reason)})`
      : day.guest_name
        ? `${shortDate(day.date)} — ${day.guest_name}, открыть бронь`
        : `${shortDate(day.date)} — свободно, забронировать`

  return (
    <div className="cal-grid">
      {DOW.map((name) => (
        <div key={name} className="cal-dow">
          {name}
        </div>
      ))}

      {Array.from({ length: leadingBlanks }, (_, index) => (
        <div key={`blank-${index}`} className="cal-day is-empty" />
      ))}

      {days.map((day) => {
        const shared = {
          // Off sale is drawn on the day, not instead of it: the number has to
          // stay readable, because the reason to look at this grid is to count
          // along to a date.
          className: `cal-day ${day.date === today ? 'is-today' : ''} ${
            day.blocked ? 'is-blocked' : ''
          }`,
          'data-status': day.status,
          children: Number(day.date.slice(8, 10)),
        }

        // A blocked day is not pressable. Opening the booking form on it would
        // be offering a night the server refuses — and the honest way back on
        // sale is «Вернуть в продажу» on the object, not a form that fails.
        if (day.blocked) {
          return <div key={day.date} {...shared} title={label(day)} aria-label={label(day)} />
        }

        return onSelect ? (
          <button
            key={day.date}
            type="button"
            {...shared}
            aria-label={label(day)}
            title={label(day)}
            onClick={() => onSelect(day)}
          />
        ) : (
          <div key={day.date} {...shared} title={day.guest_name ?? 'Свободно'} />
        )
      })}
    </div>
  )
}
