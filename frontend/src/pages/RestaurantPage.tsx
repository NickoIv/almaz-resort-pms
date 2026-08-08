import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import QuickBookModal from '../components/QuickBookModal'
import UnitCard from '../components/UnitCard'
import { Alert, EmptyState, Spinner, StatusDot } from '../components/ui'
import type { Unit, UnitType } from '../types'

const TABS: { type: UnitType; label: string }[] = [
  { type: 'sunbed', label: 'Топчаны' },
  { type: 'gazebo', label: 'Беседки' },
  { type: 'vip_gazebo', label: 'VIP-беседки' },
]

/**
 * Restaurant / recreation area. Same units and bookings API as the rooms
 * module, but sold by the hour: cards show a clock range, and waiters get a
 * one-tap quick-booking flow.
 */
export default function RestaurantPage() {
  const navigate = useNavigate()

  const [units, setUnits] = useState<Unit[]>([])
  const [tab, setTab] = useState<UnitType>('sunbed')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quickUnit, setQuickUnit] = useState<Unit | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<Unit[]>('/units?type=sunbed,gazebo,vip_gazebo')
      .then(setUnits)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const visible = units.filter((unit) => unit.type === tab)
  const busy = visible.filter((unit) => unit.status !== 'free').length

  function countFor(type: UnitType) {
    return units.filter((unit) => unit.type === type).length
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Зона отдыха</h1>
          <div className="page-sub">
            {units.length} объектов · {busy} занято в текущей категории
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      <nav className="tabs">
        {TABS.map((item) => (
          <button
            key={item.type}
            type="button"
            className={`tab ${tab === item.type ? 'active' : ''}`}
            onClick={() => setTab(item.type)}
          >
            {item.label}
            <span className="tab-count">{countFor(item.type)}</span>
          </button>
        ))}
      </nav>

      <div className="legend">
        <span>
          <StatusDot status="free" /> свободен
        </span>
        <span>
          <StatusDot status="booked" /> забронирован
        </span>
        <span>
          <StatusDot status="occupied" /> занят
        </span>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState icon="🌴">В этой категории пока нет объектов</EmptyState>
      ) : (
        <div className="unit-grid">
          {visible.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              // Opening a card shows the unit's detail view (calendar, payment
              // breakdown, guest) — the same one the rooms grid opens.
              onOpen={(selected) => navigate(`/units/${selected.id}`)}
              action={
                unit.status === 'free' ? (
                  <button
                    className="btn btn-sm btn-primary card-action"
                    onClick={() => setQuickUnit(unit)}
                  >
                    Занять сейчас
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      )}

      {quickUnit && (
        <QuickBookModal unit={quickUnit} onClose={() => setQuickUnit(null)} onSaved={load} />
      )}
    </>
  )
}