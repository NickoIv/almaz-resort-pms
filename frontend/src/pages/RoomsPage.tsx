import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import UnitCard from '../components/UnitCard'
import { Alert, EmptyState, Spinner, StatusDot } from '../components/ui'
import type { Unit } from '../types'

export default function RoomsPage() {
  const navigate = useNavigate()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<Unit[]>('/units?type=room')
      .then(setUnits)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const counts = {
    free: units.filter((u) => u.status === 'free').length,
    booked: units.filter((u) => u.status === 'booked').length,
    occupied: units.filter((u) => u.status === 'occupied').length,
    cleaning: units.filter((u) => u.needs_cleaning).length,
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Номера</h1>
          <div className="page-sub">
            {units.length} номеров · {counts.occupied} занято · {counts.booked} забронировано
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      <div className="legend">
        <span>
          <StatusDot status="free" /> свободен ({counts.free})
        </span>
        <span>
          <StatusDot status="booked" /> забронирован ({counts.booked})
        </span>
        <span>
          <StatusDot status="occupied" /> занят ({counts.occupied})
        </span>
        <span>
          <StatusDot status="cleaning" /> требует уборки ({counts.cleaning})
        </span>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : units.length === 0 ? (
        <EmptyState icon="🏨">Номера не найдены</EmptyState>
      ) : (
        <div className="unit-grid">
          {units.map((unit) => (
            <UnitCard key={unit.id} unit={unit} onOpen={(u) => navigate(`/rooms/${u.id}`)} />
          ))}
        </div>
      )}
    </>
  )
}