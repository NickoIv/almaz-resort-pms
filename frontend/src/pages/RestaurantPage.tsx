import { useCallback, useEffect, useState } from 'react'
import { useLiveData } from '../useLiveData'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import QuickBookModal from '../components/QuickBookModal'
import UnitCard from '../components/UnitCard'
import { Alert, EmptyState, Spinner, StatusBadge } from '../components/ui'
import type { Unit, UnitType } from '../types'

const TABS: { type: UnitType; label: string }[] = [
  { type: 'sunbed', label: 'Топчаны' },
  { type: 'gazebo', label: 'Беседки' },
  { type: 'vip_gazebo', label: 'VIP-беседки' },
  // Пакет, а не четвёртый вид мебели: костровая зона сдаётся целиком под одно
  // событие. Вкладкой — потому что вопрос «что у нас с зоной на субботу»
  // задают так же, как про беседки, и ответ должен лежать там же.
  { type: 'banquet_zone', label: 'Костровая зона' },
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

  const load = useCallback((background = false) => {
    if (!background) setLoading(true)
    api<Unit[]>('/units?type=sunbed,gazebo,vip_gazebo,banquet_zone')
      .then(setUnits)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])
  // The waiter's grid: sittings begin and end while it is being looked at.
  useLiveData(load, { poll: true })

  const visible = units.filter((unit) => unit.type === tab)
  // Объект внутри идущего события занят, хотя своей брони на нём нет: событие —
  // одна бронь на всю зону. Без этого счётчик отвечал бы «0 занято» над тремя
  // беседками, на которых сидит юбилей.
  const busy = visible.filter((unit) => unit.status !== 'free' || unit.zone?.booking).length

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
          <button className="btn btn-sm" onClick={() => load()}>
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
        <StatusBadge status="free" />
        <StatusBadge status="booked" />
        <StatusBadge status="occupied" />
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
                // «Занять сейчас» не предлагается там, где сервер всё равно
                // откажет: внутри идущего события и на объекте, которого нет.
                // Кнопка, ведущая в отказ, учит не доверять кнопкам.
                unit.status === 'free' && !unit.zone?.booking && !unit.renovation ? (
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