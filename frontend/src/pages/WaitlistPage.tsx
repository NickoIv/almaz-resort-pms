import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, EmptyState, Spinner } from '../components/ui'
import { dateRange } from '../format'
import { UNIT_TYPE_LABELS, type WaitlistEntry, type WaitlistStatus } from '../types'

const STATUS_LABELS: Record<WaitlistStatus, string> = {
  open: 'Ждёт',
  placed: 'Размещён',
  closed: 'Закрыт',
}

const FILTERS: { key: WaitlistStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'open', label: 'Ждут' },
  { key: 'placed', label: 'Размещены' },
  { key: 'closed', label: 'Закрыты' },
]

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [filter, setFilter] = useState<WaitlistStatus | 'all'>('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<WaitlistEntry[]>(`/waitlist${filter === 'all' ? '' : `?status=${filter}`}`)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(load, [load])

  async function setStatus(entry: WaitlistEntry, status: WaitlistStatus) {
    setBusyId(entry.id)
    setError(null)
    try {
      await api(`/waitlist/${entry.id}`, { method: 'PATCH', body: { status } })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusyId(null)
    }
  }

  const open = entries.filter((entry) => entry.status === 'open').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Лист ожидания</h1>
          <div className="page-sub">
            {entries.length} записей{filter === 'all' ? '' : ' в фильтре'} · {open} ждут
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      <div className="chip-row" style={{ marginBottom: 18 }}>
        {FILTERS.map((item) => (
          <button
            key={item.key}
            className={`chip ${filter === item.key ? 'active' : ''}`}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <EmptyState icon="📝">Записей нет</EmptyState>
      ) : (
        <section className="panel glass">
          <div className="row-list">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`row-card ${entry.status !== 'open' ? 'is-disabled' : ''}`}
              >
                <div className="row-main">
                  <div className="row-title">
                    {entry.guest_name}
                    <span className="tag">{STATUS_LABELS[entry.status]}</span>
                    {/* Dates already in the past — shown so the list can be tidied. */}
                    {entry.is_stale && <span className="tag tag-off">даты прошли</span>}
                  </div>
                  <div className="row-sub">
                    {entry.guest_phone ?? 'без телефона'} · {UNIT_TYPE_LABELS[entry.unit_type]}
                    {entry.unit_name ? ` «${entry.unit_name}»` : ''} ·{' '}
                    {dateRange(entry.date_from, entry.date_to)}
                  </div>
                  {entry.note && <div className="setting-hint">{entry.note}</div>}
                </div>

                <div className="row-actions">
                  {entry.status === 'open' ? (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() => setStatus(entry, 'placed')}
                        disabled={busyId === entry.id}
                      >
                        Размещён
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setStatus(entry, 'closed')}
                        disabled={busyId === entry.id}
                      >
                        Закрыть
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setStatus(entry, 'open')}
                      disabled={busyId === entry.id}
                    >
                      Вернуть в ожидание
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
