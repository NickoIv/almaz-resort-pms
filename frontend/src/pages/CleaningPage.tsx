import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveData } from '../useLiveData'
import { api } from '../api'
import CleaningSheet from '../components/CleaningSheet'
import Checklist from '../components/Checklist'
import { Alert, EmptyState, Spinner, StatusDot } from '../components/ui'
import { elapsedLabel } from '../format'
import type { ChecklistItem, CleaningOverview, CleaningUnit } from '../types'

/**
 * "What needs cleaning today" — the housekeeper's whole app.
 * No prices, no bookings; just units with outstanding checklist items.
 */
export default function CleaningPage() {
  const [units, setUnits] = useState<CleaningUnit[]>([])
  const [slaMinutes, setSlaMinutes] = useState(60)
  const [showSheet, setShowSheet] = useState(false)
  const [selected, setSelected] = useState<CleaningUnit | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)

  const load = useCallback((background = false) => {
    // Never a spinner over a checklist being ticked — see useLiveData.
    if (!background) setLoading(true)
    api<CleaningOverview>('/cleaning')
      .then((data) => {
        setUnits(data.units)
        setSlaMinutes(data.sla_minutes)
        setSelected(
          (current) => data.units.find((unit) => unit.id === current?.id) ?? data.units[0] ?? null
        )
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])
  // Rooms are dirtied by other people's checkouts while this page is open, and
  // this is the page a housekeeper leaves up for a whole shift.
  useLiveData(load, { poll: true })

  useEffect(() => {
    if (!selected) {
      setItems([])
      return
    }
    api<ChecklistItem[]>(`/cleaning/unit/${selected.id}`).then(setItems).catch(() => setItems([]))
  }, [selected])

  const doneCount = items.filter((item) => item.is_done).length
  const allDone = items.length > 0 && doneCount === items.length
  const overdue = units.filter((unit) => unit.is_overdue).length

  /** Guarded: jsdom has no `matchMedia`, and this must not take the page down. */
  function scrollBehavior(): ScrollBehavior {
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return reduce ? 'auto' : 'smooth'
  }

  /**
   * Choosing an object, and being shown what to do in it.
   *
   * Below 980px the checklist is not beside the cards — it is under all of
   * them. Measured at 390x844 with eight objects waiting: the panel began
   * **1321px down, 1.6 screens**, and tapping a card moved nothing at all, so
   * a housekeeper picked a room and was then left hunting for its checklist.
   * Fourteen rooms puts it past two screens.
   *
   * Geometry rather than `scrollIntoView` — the same reason the board computes
   * its own `scrollLeft` — and only when the panel is not already up, so that
   * on a desktop, where it sits beside the cards, nothing moves under the
   * reader at all.
   */
  function choose(unit: CleaningUnit) {
    setSelected(unit)
    const box = panel.current
    if (!box) return
    // After the click has been painted: the panel's height changes with the
    // checklist it is about to show.
    requestAnimationFrame(() => {
      const top = box.getBoundingClientRect().top
      if (top >= 0 && top < window.innerHeight / 2) return
      window.scrollTo({ top: top + window.scrollY - 12, behavior: scrollBehavior() })
    })
  }

  /** Finished with this one: refresh the list, and put the reader back at it. */
  function finish() {
    load()
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Уборка</h1>
          <div className="page-sub">
            {units.length > 0 ? `${units.length} объектов ждут уборки` : 'Всё убрано'}
            {overdue > 0 && (
              <span className="sla-warn"> · {overdue} дольше {slaMinutes} мин</span>
            )}
          </div>
        </div>
        <div className="page-head-actions">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setShowSheet(true)}
            disabled={units.length === 0}
          >
            Печать заданий на смену
          </button>
          <button className="btn btn-sm" onClick={() => load()}>
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
                className={`unit-card glass ${unit.is_overdue ? 'is-overdue' : ''}`}
                data-status={unit.id === selected?.id ? 'booked' : undefined}
                onClick={() => choose(unit)}
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
                <div className="unit-foot">
                  <span
                    className={`sla ${unit.is_overdue ? 'sla-over' : ''}`}
                    title={unit.waiting_since ? `С ${unit.waiting_since}` : undefined}
                  >
                    ждёт {elapsedLabel(unit.waiting_minutes)}
                    {unit.is_overdue && ` · дольше ${slaMinutes} мин`}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <section className="panel glass" ref={panel}>
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
              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 16 }}
                onClick={finish}
              >
                Готово — обновить список
              </button>
            )}
          </section>
        </div>
      )}

      {showSheet && <CleaningSheet onClose={() => setShowSheet(false)} />}
    </>
  )
}