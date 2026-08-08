import { compactMoney, money, percent } from '../format'
import type { Analytics } from '../types'

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/**
 * Revenue and occupancy per day of week, to show which weekdays underperform.
 *
 * A table with inline bars rather than a chart: two measures on different
 * scales (money and a percentage) must not share one axis, and seven rows read
 * perfectly well as a table. The bars are sized within each column separately,
 * so each is compared against its own best day.
 */
export default function WeekdayBreakdown({ weekdays }: { weekdays: Analytics['weekdays'] }) {
  if (!weekdays || weekdays.length === 0) return null

  const maxRevenue = Math.max(...weekdays.map((day) => day.revenue), 1)
  const maxOccupancy = Math.max(...weekdays.map((day) => day.occupancy_rate), 0.01)

  const withData = weekdays.filter((day) => day.days > 0)
  const totalRevenue = weekdays.reduce((sum, day) => sum + day.revenue, 0)

  // Only call out a weak day when there is something to compare against.
  const weakest =
    withData.length >= 2
      ? withData.reduce((worst, day) => (day.revenue < worst.revenue ? day : worst))
      : null

  return (
    <>
      <table className="data-table weekday-table">
        <thead>
          <tr>
            <th>День недели</th>
            <th>Выручка</th>
            <th className="num">Сумма</th>
            <th>Загрузка</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {weekdays.map((day) => (
            <tr key={day.dow} className={weakest?.dow === day.dow ? 'is-weakest' : undefined}>
              <td>
                <span className="weekday-name" title={DAY_NAMES[day.dow]}>
                  {DAY_SHORT[day.dow]}
                </span>
                <span className="weekday-count">{day.days} дн.</span>
              </td>
              <td>
                <span className="bar">
                  <span
                    className="bar-fill bar-revenue"
                    style={{ width: `${(day.revenue / maxRevenue) * 100}%` }}
                  />
                </span>
              </td>
              <td className="num">{compactMoney(day.revenue)}</td>
              <td>
                <span className="bar">
                  <span
                    className="bar-fill bar-occupancy"
                    style={{ width: `${(day.occupancy_rate / maxOccupancy) * 100}%` }}
                  />
                </span>
              </td>
              <td className="num">{percent(day.occupancy_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {weakest && totalRevenue > 0 && (
        <div className="field-hint" style={{ marginTop: 12 }}>
          Самый слабый день — {DAY_NAMES[weakest.dow].toLowerCase()}: {money(weakest.revenue)} и{' '}
          {percent(weakest.occupancy_rate)} загрузки за {weakest.days} дн.
        </div>
      )}
    </>
  )
}
