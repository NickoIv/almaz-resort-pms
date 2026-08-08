import type { CalendarDay } from '../types'
import { todayIso } from '../format'

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/**
 * Monday-based column index for a YYYY-MM-DD string. Computed in UTC so the
 * grid does not shift a column depending on where the viewer is.
 */
function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

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

  return (
    <div className="cal-grid">
      {DOW.map((label) => (
        <div key={label} className="cal-dow">
          {label}
        </div>
      ))}

      {Array.from({ length: leadingBlanks }, (_, index) => (
        <div key={`blank-${index}`} className="cal-day is-empty" />
      ))}

      {days.map((day) => (
        <div
          key={day.date}
          className={`cal-day ${day.date === today ? 'is-today' : ''}`}
          data-status={day.status}
          title={day.guest_name ?? 'Свободно'}
          onClick={() => onSelect?.(day)}
          role={onSelect ? 'button' : undefined}
        >
          {Number(day.date.slice(8, 10))}
        </div>
      ))}
    </div>
  )
}