import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import Checklist from '../components/Checklist'
import { Alert, EmptyState, Spinner, StatusDot } from '../components/ui'
import type { ChecklistItem, CleaningUnit } from '../types'

/**
 * "What needs cleaning today" — the housekeeper's whole app.
 * No prices, no bookings; just units with outstanding checklist items.
 */
export default function CleaningPage() {
  const [units, setUnits] = useState<CleaningUnit[]>([])
  const [selected, setSelected] = useState<CleaningUnit | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<CleaningUnit[]>('/cleaning')
      .then((data) => {
        setUnits(data)
        setSelected((current) => data.find((unit) => unit.id === current?.id) ?? data[0] ?? null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    if (!selected) {
      setItems([])
      return
    }
    api<ChecklistItem[]>(`/cleaning/unit/${selected.id}`).then(setItems).catch(() => setItems([]))
  }, [selected])

  const doneCount = items.filter((item) => item.is_done).length
  const allDone = items.length > 0 && doneCount === items.length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Уборка</h1>
          <div className="page-sub">
            {units.length > 0 ? `${units.length} объектов ждут уборки` : 'Всё убрано'}
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : units.length === 0 ? (
        <EmptyState icon="✨">Сегодня убирать нечего — все объекты чистые.</EmptyState>
      ) : (
        <div className="detail-grid">
          <div className="unit-grid">
            {units.map((unit) => (
              <button
                key={unit.id}
                type="button"
                className="unit-card glass"
                data-status={unit.id === selected?.id ? 'booked' : undefined}
                onClick={() => setSelected(unit)}
              >
                <div className="unit-card-top">
                  <div>
                    <div className="unit-name">{unit.name}</div>
                    <div className="unit-meta">{unit.category ?? '—'}</div>
                  </div>
                  <span className="unit-status">
                    <StatusDot status="cleaning" />
                    {unit.pending} из {unit.total}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <section className="panel glass">
            <div className="panel-title">
              <StatusDot status="cleaning" />
              {selected ? selected.name : 'Выберите объект'}
              {items.length > 0 && (
                <span className="count">
                  {doneCount} / {items.length}
                </span>
              )}
            </div>

            <Checklist
              items={items}
              onChanged={(updated) =>
                setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
              }
            />

            {allDone && (
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={load}>
                Готово — обновить список
              </button>
            )}
          </section>
        </div>
      )}
    </>
  )
}