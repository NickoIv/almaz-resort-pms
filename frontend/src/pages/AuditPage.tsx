import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, EmptyState, Spinner } from '../components/ui'
import { downloadCsv } from '../csv'
import { todayIso } from '../format'
import { ROLE_LABELS, type Role } from '../types'

type AuditEntry = {
  id: number
  staff_user_id: number | null
  staff_name: string | null
  staff_role: Role | null
  action: string
  entity: string
  entity_id: number | null
  created_at: string
  target: string | null
  guest_name: string | null
}

type AuditResponse = {
  total: number
  limit: number
  offset: number
  entries: AuditEntry[]
}

type Filters = { actions: string[]; staff: { id: number; name: string; role: Role }[] }

const PAGE_SIZE = 50

/** Human wording for the action verbs written by writeAudit(). */
const ACTION_LABELS: Record<string, string> = {
  'login': 'Вход в систему',
  'booking.create': 'Создана бронь',
  'booking.quick': 'Быстрая бронь',
  'booking.payment': 'Внесена оплата',
  'booking.group.create': 'Создана групповая бронь',
  'booking.group.payment': 'Оплата по группе',
  'charge.create': 'Начисление добавлено',
  'charge.delete': 'Начисление удалено',
  'cleaning.done': 'Пункт уборки выполнен',
  'cleaning.undone': 'Пункт уборки снят',
  'cleaning.reset': 'Чек-лист сброшен',
  'settings.update': 'Изменены настройки',
  'guest.notes': 'Заметка о госте',
}

const STATUS_WORDS: Record<string, string> = {
  free: 'выезд / отмена',
  booked: 'бронь',
  occupied: 'заселение',
}

function describe(entry: AuditEntry): string {
  if (ACTION_LABELS[entry.action]) return ACTION_LABELS[entry.action]

  // booking.update:<status> carries the new status after the colon.
  if (entry.action.startsWith('booking.update:')) {
    const status = entry.action.split(':')[1]
    return `Изменена бронь — ${STATUS_WORDS[status] ?? status}`
  }
  if (entry.action.startsWith('notification.test')) {
    return `Тест уведомления (${entry.action.split(':')[1] ?? ''})`.trim()
  }
  return entry.action
}

const GROUP_LABELS: Record<string, string> = {
  booking: 'Брони',
  charge: 'Начисления',
  cleaning: 'Уборка',
  settings: 'Настройки',
  login: 'Входы',
  guest: 'Гости',
  notification: 'Уведомления',
}

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null)
  const [filters, setFilters] = useState<Filters>({ actions: [], staff: [] })
  const [action, setAction] = useState('')
  const [staffId, setStaffId] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    })
    if (action) params.set('action', action)
    if (staffId) params.set('staff_id', staffId)

    api<AuditResponse>(`/audit?${params}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [action, staffId, page])

  useEffect(load, [load])

  useEffect(() => {
    api<Filters>('/audit/filters')
      .then(setFilters)
      .catch(() => setFilters({ actions: [], staff: [] }))
  }, [])

  function exportCsv() {
    if (!data) return
    downloadCsv(`almaz-pms-audit-${todayIso()}.csv`, [
      ['Журнал действий персонала'],
      [],
      ['Когда', 'Сотрудник', 'Роль', 'Действие', 'Объект', 'Гость', 'Код'],
      ...data.entries.map((entry) => [
        entry.created_at,
        entry.staff_name ?? '—',
        entry.staff_role ? ROLE_LABELS[entry.staff_role] : '—',
        describe(entry),
        entry.target ?? (entry.entity_id ? `${entry.entity} #${entry.entity_id}` : entry.entity),
        entry.guest_name ?? '',
        entry.action,
      ]),
    ])
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Журнал действий</h1>
          <div className="page-sub">
            {data ? `${data.total} записей` : 'Загрузка…'} · кто и когда менял брони и статусы
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={exportCsv} disabled={!data?.entries.length}>
            Экспорт CSV
          </button>
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="chip-row">
          <button
            className={`chip ${action === '' ? 'active' : ''}`}
            onClick={() => {
              setAction('')
              setPage(0)
            }}
          >
            Все действия
          </button>
          {filters.actions.map((item) => (
            <button
              key={item}
              className={`chip ${action === item ? 'active' : ''}`}
              onClick={() => {
                setAction(item)
                setPage(0)
              }}
            >
              {GROUP_LABELS[item] ?? item}
            </button>
          ))}
        </div>

        {filters.staff.length > 0 && (
          <div className="chip-row">
            <button
              className={`chip ${staffId === '' ? 'active' : ''}`}
              onClick={() => {
                setStaffId('')
                setPage(0)
              }}
            >
              Все сотрудники
            </button>
            {filters.staff.map((person) => (
              <button
                key={person.id}
                className={`chip ${staffId === String(person.id) ? 'active' : ''}`}
                onClick={() => {
                  setStaffId(String(person.id))
                  setPage(0)
                }}
                title={ROLE_LABELS[person.role]}
              >
                {person.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : !data || data.entries.length === 0 ? (
        <EmptyState icon="📋">Записей не найдено</EmptyState>
      ) : (
        <>
          <section className="panel glass">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Сотрудник</th>
                  <th>Действие</th>
                  <th>Объект</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="audit-when">{entry.created_at.replace('T', ' ').slice(0, 16)}</td>
                    <td>
                      {entry.staff_name ?? '—'}
                      {entry.staff_role && (
                        <span className="audit-role">{ROLE_LABELS[entry.staff_role]}</span>
                      )}
                    </td>
                    <td>{describe(entry)}</td>
                    <td>
                      {entry.target ?? (entry.entity_id ? `#${entry.entity_id}` : '—')}
                      {entry.guest_name && <span className="audit-guest">{entry.guest_name}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {totalPages > 1 && (
            <div className="pager">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ← Назад
              </button>
              <span className="pager-info">
                {page + 1} из {totalPages}
              </span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setPage((p) => p + 1)}
                disabled={page + 1 >= totalPages}
              >
                Вперёд →
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
