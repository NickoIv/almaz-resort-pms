import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, Spinner } from './ui'
import { money } from '../format'
import { UNIT_TYPE_LABELS, type Rate, type RateDraft, type UnitType } from '../types'

const UNIT_TYPES: UnitType[] = ['room', 'sunbed', 'gazebo', 'vip_gazebo']

/**
 * The price list.
 *
 * Edited as a table and saved whole, because that is how a price list is
 * thought about: you look at the whole thing, change two numbers and a season,
 * and want what you see to be what is stored. Row-by-row saving would leave
 * states where a season exists and its prices do not.
 *
 * Two prices, not seven. A hotel an hour outside Almaty fills at the weekend,
 * so Friday and Saturday nights cost more — that is the distinction that earns
 * its place on the screen. Everything else a chain PMS offers here (packages,
 * early-booking discounts, length-of-stay rules, a price per day of the week)
 * is a tariff engine for a business with a revenue manager, and this hotel has
 * fourteen rooms.
 */
export default function RatesPanel() {
  const [rows, setRows] = useState<RateDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<{ rates: Rate[] }>('/rates')
      .then((data) => {
        setRows(data.rates)
        setDirty(false)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить прайс'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  function patch(index: number, change: Partial<RateDraft>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)))
    setDirty(true)
    setNotice(null)
  }

  function addRow(season: boolean) {
    setRows((current) => [
      ...current,
      {
        unit_type: 'room',
        category: null,
        weekday_price: 0,
        weekend_price: 0,
        season_name: season ? 'Сезон' : null,
        season_from: null,
        season_to: null,
      },
    ])
    setDirty(true)
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index))
    setDirty(true)
    setNotice(null)
  }

  async function saveAll() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await api<{ rates: Rate[] }>('/rates', { method: 'PUT', body: { rates: rows } })
      setRows(saved.rates)
      setDirty(false)
      setNotice('Прайс сохранён')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить прайс')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <section className="panel glass" style={{ marginBottom: 18 }}>
      <div className="panel-title">
        Прайс-лист
        <span className="count">подставляется в новую бронь</span>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <div className="notice">{notice}</div>}

      {rows.length === 0 ? (
        <div className="field-hint">
          Прайс пуст — сумма в брони вводится вручную, как и раньше. Добавьте строку, и она
          будет подставляться сама; исправить её в брони по-прежнему можно.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Объект</th>
                <th>Категория</th>
                <th>Вс–Чт</th>
                <th>Пт–Сб</th>
                <th>Сезон</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    <select
                      aria-label="Тип объекта"
                      value={row.unit_type}
                      onChange={(event) =>
                        patch(index, { unit_type: event.target.value as UnitType })
                      }
                    >
                      {UNIT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {UNIT_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label="Категория"
                      value={row.category ?? ''}
                      onChange={(event) => patch(index, { category: event.target.value || null })}
                      placeholder="любая"
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Цена в будни"
                      type="number"
                      min="0"
                      value={row.weekday_price}
                      onChange={(event) =>
                        patch(index, { weekday_price: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Цена в выходные"
                      type="number"
                      min="0"
                      value={row.weekend_price}
                      onChange={(event) =>
                        patch(index, { weekend_price: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    {row.season_name === null && row.season_from === null ? (
                      <span className="rate-always">круглый год</span>
                    ) : (
                      <div className="rate-season">
                        <input
                          aria-label="Название сезона"
                          value={row.season_name ?? ''}
                          onChange={(event) =>
                            patch(index, { season_name: event.target.value || null })
                          }
                          placeholder="Лето"
                        />
                        <input
                          aria-label="Начало сезона"
                          type="date"
                          value={row.season_from ?? ''}
                          onChange={(event) =>
                            patch(index, { season_from: event.target.value || null })
                          }
                        />
                        <input
                          aria-label="Конец сезона"
                          type="date"
                          value={row.season_to ?? ''}
                          onChange={(event) =>
                            patch(index, { season_to: event.target.value || null })
                          }
                        />
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => removeRow(index)}
                      aria-label="Удалить строку"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="chip-row" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-sm" onClick={() => addRow(false)}>
          + Цена
        </button>
        <button type="button" className="btn btn-sm" onClick={() => addRow(true)}>
          + Сезон
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => void saveAll()}
          disabled={saving || !dirty}
        >
          {saving ? 'Сохранение…' : 'Сохранить прайс'}
        </button>
      </div>

      <div className="field-hint" style={{ marginTop: 16 }}>
        Выходными считаются <strong>ночи пятницы и субботы</strong> — те, за которые приезжают.
        Ночь воскресенья идёт по будней цене. Пустая категория означает «любая» и работает как
        запасной вариант, если для конкретной категории строки нет; сезон перебивает
        круглогодичную цену на своих датах. Беседки и топчаны считаются за посадку, а не за ночь.
        {rows.length > 0 && (
          <>
            {' '}
            Например, номер категории «lux» на ночь пятницы —{' '}
            {money(
              rows.find((row) => row.unit_type === 'room' && row.category === 'lux')
                ?.weekend_price ??
                rows.find((row) => row.unit_type === 'room' && !row.category)?.weekend_price ??
                0
            )}
            .
          </>
        )}
      </div>
    </section>
  )
}
