import { useEffect, useState } from 'react'
import { api } from '../api'
import { Spinner } from './ui'
import { percent, todayIso } from '../format'

type ForecastDay = {
  date: string
  taken: number
  free: number
  occupancy_rate: number
}

type Forecast = { total_units: number; days: ForecastDay[] }

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** Weekday label computed in UTC so it cannot shift with the viewer's device. */
function weekday(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return DOW_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

/**
 * Free rooms per day for the next two weeks.
 *
 * Built for the phone call — "anything free on Friday?" — so the number of
 * *free* rooms is the headline, not a percentage. Columns are sized by how
 * full each day is, and a fully booked day is called out in words as well as
 * colour.
 */
export default function OccupancyForecast({ days = 14 }: { days?: number }) {
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api<Forecast>(`/units/forecast?days=${days}&type=room`)
      .then(setForecast)
      .catch(() => setError(true))
  }, [days])

  if (error) return null
  if (!forecast) return <Spinner />

  const today = todayIso()

  return (
    <section className="panel glass forecast">
      <div className="panel-title">
        Свободно на ближайшие {forecast.days.length} дней
        <span className="count">всего номеров: {forecast.total_units}</span>
      </div>

      <div className="forecast-grid">
        {forecast.days.map((day) => {
          const full = day.free === 0
          return (
            <div
              key={day.date}
              className={`forecast-day ${full ? 'is-full' : ''} ${
                day.date === today ? 'is-today' : ''
              }`}
              title={`${day.date}: свободно ${day.free} из ${forecast.total_units} (${percent(
                day.occupancy_rate
              )} занято)`}
            >
              <div className="forecast-bar">
                <div
                  className="forecast-bar-fill"
                  style={{ height: `${Math.round(day.occupancy_rate * 100)}%` }}
                />
                <span className="forecast-free">{day.free}</span>
              </div>
              <div className="forecast-date">{Number(day.date.slice(8, 10))}</div>
              <div className="forecast-dow">{weekday(day.date)}</div>
            </div>
          )
        })}
      </div>

      <div className="field-hint" style={{ marginTop: 10 }}>
        Число в столбце — сколько номеров свободно в эту ночь. Красный столбец — мест нет.
      </div>
    </section>
  )
}
