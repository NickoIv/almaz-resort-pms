import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import RevenueChart from '../components/RevenueChart'
import { Alert, Spinner } from '../components/ui'
import { compactMoney, money, monthShort, percent } from '../format'
import { downloadCsv } from '../csv'
import { UNIT_TYPE_LABELS, type Analytics } from '../types'

function monthStart(offset = 0): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1))
  return date.toISOString().slice(0, 10)
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

const PRESETS = [
  { label: 'Текущий месяц', from: () => monthStart(0), to: () => todayIsoUtc() },
  { label: 'Прошлый месяц', from: () => monthStart(-1), to: () => monthStart(0) },
  { label: 'Последние 3 мес.', from: () => monthStart(-2), to: () => todayIsoUtc() },
  { label: 'Год', from: () => `${new Date().getFullYear()}-01-01`, to: () => todayIsoUtc() },
]

export default function AnalyticsPage() {
  const [from, setFrom] = useState(monthStart(0))
  const [to, setTo] = useState(todayIsoUtc())
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api<Analytics>(`/analytics/summary?from=${from}&to=${to}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(load, [load])

  /** Exports exactly what is on screen, in the same order. */
  function exportCsv() {
    if (!data) return
    const mom = data.month_over_month

    const rows: (string | number | null)[][] = [
      ['Almaz Resort PMS — аналитика'],
      ['Период', data.range.from, data.range.to],
      [],
      ['Показатель', 'Значение'],
      ['Получено (оплачено)', data.totals.revenue],
      ['Начислено по броням', data.totals.accrued],
      ['Не оплачено', data.totals.outstanding],
      ['Выручка — номера', data.by_category.rooms],
      ['Выручка — зона отдыха', data.by_category.restaurant],
      ['Загрузка номеров', percent(data.occupancy.rate, 1)],
      ['Продано ночей', data.occupancy.nights_sold],
      ['Доступно ночей', data.occupancy.nights_available],
      ['Платежей', data.totals.payments],
      ['Броней', data.totals.bookings],
      [],
      ['Выручка по типам объектов'],
      ['Тип', 'Выручка', 'Броней', 'Платежей'],
      ...data.by_type.map((row) => [
        UNIT_TYPE_LABELS[row.type],
        row.revenue,
        row.bookings,
        row.payments,
      ]),
      [],
      ['Помесячно'],
      ['Месяц', 'Номера', 'Зона отдыха', 'Всего'],
      ...data.months.map((row) => [row.month, row.rooms, row.restaurant, row.revenue]),
      [],
      ['Месяц к месяцу'],
      [mom.current.month, mom.current.revenue],
      [mom.previous.month, mom.previous.revenue],
      ['Изменение', percent(mom.change, 1)],
    ]

    downloadCsv(`almaz-pms-analytics-${data.range.from}_${data.range.to}.csv`, rows)
  }

  const mom = data?.month_over_month
  const changeUp = (mom?.change ?? 0) >= 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Аналитика</h1>
          <div className="page-sub">
            {data ? `${data.range.from} — ${data.range.to}` : 'Загрузка…'}
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={exportCsv} disabled={!data}>
            Экспорт CSV
          </button>
        </div>
      </div>

      <div className="filters">
        {PRESETS.map((preset) => {
          const active = from === preset.from() && to === preset.to()
          return (
            <button
              key={preset.label}
              type="button"
              className={`chip ${active ? 'active' : ''}`}
              onClick={() => {
                setFrom(preset.from())
                setTo(preset.to())
              }}
            >
              {preset.label}
            </button>
          )
        })}
        <div className="filters-dates">
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <span>—</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="stat-row">
            <div className="stat glass">
              <div className="stat-label">Получено</div>
              <div className="stat-value">{money(data.totals.revenue)}</div>
              <div className="stat-foot">
                {data.totals.payments} платежей · {data.totals.bookings} броней
              </div>
            </div>

            {/* Collected money on its own reads as "0 ₸ despite active bookings"
                whenever guests have booked but not yet paid. These two make the
                difference explicit. */}
            <div className="stat glass">
              <div className="stat-label">Начислено по броням</div>
              <div className="stat-value">{money(data.totals.accrued)}</div>
              <div className="stat-foot">стоимость броней за период, включая начисления</div>
            </div>

            <div className="stat glass">
              <div className="stat-label">Не оплачено</div>
              <div className={`stat-value ${data.totals.outstanding > 0 ? 'money-due' : ''}`}>
                {money(data.totals.outstanding)}
              </div>
              <div className="stat-foot">
                {data.totals.accrued > 0
                  ? `${percent(data.totals.revenue / data.totals.accrued)} собрано`
                  : 'нет броней за период'}
              </div>
            </div>

            <div className="stat glass">
              <div className="stat-label">Номера</div>
              <div className="stat-value">{money(data.by_category.rooms)}</div>
              <div className="stat-foot">
                <i className="swatch swatch-rooms" />
                {data.totals.revenue > 0
                  ? percent(data.by_category.rooms / data.totals.revenue)
                  : '0%'}{' '}
                выручки
              </div>
            </div>

            <div className="stat glass">
              <div className="stat-label">Зона отдыха</div>
              <div className="stat-value">{money(data.by_category.restaurant)}</div>
              <div className="stat-foot">
                <i className="swatch swatch-restaurant" />
                {data.totals.revenue > 0
                  ? percent(data.by_category.restaurant / data.totals.revenue)
                  : '0%'}{' '}
                выручки
              </div>
            </div>

            <div className="stat glass">
              <div className="stat-label">Загрузка номеров</div>
              <div className="stat-value">{percent(data.occupancy.rate, 1)}</div>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${data.occupancy.rate * 100}%` }} />
              </div>
              <div className="stat-foot">
                {data.occupancy.nights_sold} из {data.occupancy.nights_available} ночей
              </div>
            </div>
          </div>

          <section className="panel glass">
            <div className="panel-title">
              Выручка по месяцам
              {mom && (
                <span className="count">
                  {monthShort(mom.previous.month)} → {monthShort(mom.current.month)}:{' '}
                  <b className={changeUp ? 'delta-up' : 'delta-down'}>
                    {changeUp ? '▲' : '▼'} {percent(Math.abs(mom.change), 1)}
                  </b>
                </span>
              )}
            </div>
            <RevenueChart months={data.months} />
          </section>

          <section className="panel glass">
            <div className="panel-title">
              Выручка по типам объектов
              <span className="count">за период</span>
            </div>
            {data.by_type.length === 0 ? (
              <div className="unit-empty">За выбранный период платежей не было</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Броней</th>
                    <th>Платежей</th>
                    <th>Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_type.map((row) => (
                    <tr key={row.type}>
                      <td>
                        <i className={`swatch swatch-${row.category}`} />
                        {UNIT_TYPE_LABELS[row.type]}
                      </td>
                      <td>{row.bookings}</td>
                      <td>{row.payments}</td>
                      <td className="num">{compactMoney(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  )
}