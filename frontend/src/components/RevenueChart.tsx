import { useState } from 'react'
import { compactMoney, money, monthShort } from '../format'
import type { Analytics } from '../types'

type MonthPoint = Analytics['months'][number]

/**
 * Revenue by month, split rooms vs recreation area — a stacked column chart.
 * Two series, so the palette uses categorical slots 1 and 2 (blue / orange);
 * both are validated against this app's dark surface for contrast and CVD
 * separation. The two most recent columns carry direct labels so the
 * month-over-month comparison is readable without the tooltip.
 */
export default function RevenueChart({ months }: { months: MonthPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null)

  const max = Math.max(...months.map((month) => month.revenue), 1)
  // Round the axis up to a clean step so gridlines land on readable numbers.
  const step = Math.pow(10, Math.floor(Math.log10(max)))
  const ceiling = Math.ceil(max / step) * step || 1
  const ticks = [0, 0.5, 1].map((fraction) => fraction * ceiling)

  if (months.every((month) => month.revenue === 0)) {
    return <div className="chart-empty">За выбранный период платежей не было</div>
  }

  return (
    <figure className="chart">
      <div className="chart-legend">
        <span>
          <i className="swatch swatch-rooms" /> Номера
        </span>
        <span>
          <i className="swatch swatch-restaurant" /> Зона отдыха
        </span>
      </div>

      <div className="chart-body">
        <div className="chart-axis">
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{compactMoney(tick)}</span>
          ))}
        </div>

        <div className="chart-plot">
          {ticks.map((tick) => (
            <div key={tick} className="chart-grid" style={{ bottom: `${(tick / ceiling) * 100}%` }} />
          ))}

          {months.map((month, index) => {
            const isRecent = index >= months.length - 2
            const roomsShare = (month.rooms / ceiling) * 100
            const restaurantShare = (month.restaurant / ceiling) * 100

            return (
              <div
                key={month.month}
                className={`chart-col ${hovered === index ? 'is-hovered' : ''}`}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              >
                {(isRecent || hovered === index) && month.revenue > 0 && (
                  <div className="chart-value">{compactMoney(month.revenue)}</div>
                )}

                <div className="chart-stack">
                  <div
                    className="chart-seg seg-restaurant"
                    style={{ height: `${restaurantShare}%` }}
                  />
                  <div className="chart-seg seg-rooms" style={{ height: `${roomsShare}%` }} />
                </div>

                {hovered === index && (
                  <div className="chart-tip glass">
                    <div className="chart-tip-title">{monthShort(month.month)}</div>
                    <div className="chart-tip-row">
                      <i className="swatch swatch-rooms" /> Номера
                      <b>{money(month.rooms)}</b>
                    </div>
                    <div className="chart-tip-row">
                      <i className="swatch swatch-restaurant" /> Зона отдыха
                      <b>{money(month.restaurant)}</b>
                    </div>
                    <div className="chart-tip-row total">
                      Всего <b>{money(month.revenue)}</b>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="chart-labels">
        {months.map((month, index) => (
          <span key={month.month} className={index >= months.length - 2 ? 'is-recent' : undefined}>
            {monthShort(month.month)}
          </span>
        ))}
      </div>
    </figure>
  )
}