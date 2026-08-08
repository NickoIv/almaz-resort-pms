import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import UnitCard from '../components/UnitCard'
import { Alert, EmptyState, Spinner, StatusDot } from '../components/ui'
import type { Unit, UnitType } from '../types'

const TABS: { type: UnitType; label: string }[] = [
  { type: 'sunbed', label: 'Топчаны' },
  { type: 'gazebo', label: 'Беседки' },
  { type: 'vip_gazebo', label: 'VIP-беседки' },
]

/**
 * Restaurant / recreation area. The full module (hourly booking, quick-book
 * for waiters, tabs per unit type) is built in the next step; this view already
 * shows live status so waiters have a working dashboard after login.
 */
export default function RestaurantPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [tab, setTab] = useState<UnitType>('sunbed')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<Unit[]>('/units?type=sunbed,gazebo,vip_gazebo')
      .then(setUnits)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const visible = units.filter((unit) => unit.type === tab)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Зона отдыха</h1>
          <div className="page-sub">{units.length} объектов</div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      <nav className="nav" style={{ marginBottom: 20, marginLeft: 0 }}>
        {TABS.map((item) => (
          <a
            key={item.type}
            href="#"
            className={tab === item.type ? 'active' : undefined}
            onClick={(event) => {
              event.preventDefault()
              setTab(item.type)
            }}
          >
            {item.label}
          </a>
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
            <UnitCard key={unit.id} unit={unit} onOpen={() => undefined} />
          ))}
        </div>
      )}
    </>
  )
}