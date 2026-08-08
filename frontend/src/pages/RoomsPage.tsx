import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import GroupBookingModal from '../components/GroupBookingModal'
import UnitCard from '../components/UnitCard'
import { Alert, EmptyState, Spinner, StatusDot } from '../components/ui'
import { matchesQuery } from '../search'
import type { Unit, UnitStatus } from '../types'

type StatusFilter = UnitStatus | 'all' | 'cleaning'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'free', label: 'Свободен' },
  { key: 'booked', label: 'Забронирован' },
  { key: 'occupied', label: 'Занят' },
  { key: 'cleaning', label: 'Требует уборки' },
]

export default function RoomsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [showGroup, setShowGroup] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api<Unit[]>('/units?type=room')
      .then(setUnits)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const counts = useMemo(
    () => ({
      all: units.length,
      free: units.filter((u) => u.status === 'free').length,
      booked: units.filter((u) => u.status === 'booked').length,
      occupied: units.filter((u) => u.status === 'occupied').length,
      cleaning: units.filter((u) => u.needs_cleaning).length,
    }),
    [units]
  )

  const visible = useMemo(
    () =>
      units
        .filter((unit) =>
          status === 'all'
            ? true
            : status === 'cleaning'
              ? unit.needs_cleaning
              : unit.status === status
        )
        .filter((unit) => matchesQuery(unit, query)),
    [units, status, query]
  )

  const filtered = query.trim() !== '' || status !== 'all'

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
          {isAdmin && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowGroup(true)}>
              Групповая бронь
            </button>
          )}
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <span className="search-icon">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск: гость, телефон, дата заезда…"
            aria-label="Поиск по гостю, телефону или дате заезда"
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Очистить">
              ×
            </button>
          )}
        </div>

        <div className="chip-row">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`chip ${status === item.key ? 'active' : ''}`}
              onClick={() => setStatus(item.key)}
            >
              {item.key !== 'all' && (
                <StatusDot status={item.key === 'cleaning' ? 'cleaning' : item.key} />
              )}
              {item.label}
              <span className="chip-count">{counts[item.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : units.length === 0 ? (
        <EmptyState icon="🏨">Номера не найдены</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon="🔍">
          Ничего не найдено
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                setQuery('')
                setStatus('all')
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        </EmptyState>
      ) : (
        <>
          {filtered && (
            <div className="result-line">
              Показано {visible.length} из {units.length}
            </div>
          )}
          <div className="unit-grid">
            {visible.map((unit) => (
              <UnitCard key={unit.id} unit={unit} onOpen={(u) => navigate(`/rooms/${u.id}`)} />
            ))}
          </div>
        </>
      )}

      {showGroup && (
        <GroupBookingModal onClose={() => setShowGroup(false)} onSaved={load} />
      )}
    </>
  )
}