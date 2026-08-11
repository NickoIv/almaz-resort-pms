import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, EmptyState, Spinner } from '../components/ui'
import { downloadCsv } from '../csv'
import { todayIso } from '../format'
import { describeAudit, GROUP_LABELS, type AuditEntry } from '../audit'
import { useIsPhone } from '../useIsPhone'
import { ROLE_LABELS, type Role } from '../types'

type AuditResponse = {
  total: number
  limit: number
  offset: number
  entries: AuditEntry[]
}

type Filters = { actions: string[]; staff: { id: number; name: string; role: Role }[] }

const PAGE_SIZE = 50

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null)
  const [filters, setFilters] = useState<Filters>({ actions: [], staff: [] })
  const [action, setAction] = useState('')
  const [staffId, setStaffId] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isPhone = useIsPhone()

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
    downloadCsv(`taura-pms-audit-${todayIso()}.csv`, [
      ['Журнал действий персонала'],
      [],
      ['Когда', 'Сотрудник', 'Роль', 'Действие', 'Объект', 'Гость', 'Код'],
      ...data.entries.map((entry) => [
        entry.created_at,
        entry.staff_name ?? '—',
        entry.staff_role ? ROLE_LABELS[entry.staff_role] : '—',
        describeAudit(entry),
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

      {/* Both chip rows are their own contained strips: with a dozen action
          buckets and every staff member who ever logged in, an unbounded row
          used to widen the page and push the heading off the left edge. */}
      <div className="toolbar">
        <div className="filter-strip">
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
          <div className="filter-strip">
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
            {/* One list, two shapes — and only ever one of them in the DOM.
                Rendering both and hiding one with CSS would have a screen
                reader read fifty journal entries twice, which is the same
                reason the shell moves its account controls instead of
                duplicating them.

                A phone gets cards. The table measured 424px against a 320px
                box, so «Объект» — the room or the guest a line is actually
                about — sat 104px past the right edge behind a horizontal
                scroll nobody would think to look for. The card carries the
                same facts down the page instead of across it. */}
            {isPhone ? (
              <div className="row-list audit-cards">
                {data.entries.map((entry) => (
                  <div className="row-card" key={entry.id}>
                    <div className="row-main">
                      <div className="row-sub audit-card-when">
                        {entry.created_at.replace('T', ' ').slice(0, 16)} ·{' '}
                        {entry.staff_name ?? '—'}
                        {entry.staff_role && ` · ${ROLE_LABELS[entry.staff_role]}`}
                      </div>
                      <div className="row-title">{describeAudit(entry)}</div>
                      {/* Only when there is something to name. The table prints
                          `#1` for a sign-in because a cell cannot be blank
                          without looking broken; a card can simply stop, and a
                          third of the entries are sign-ins. */}
                      {(entry.target || entry.guest_name) && (
                        <div className="row-sub">
                          {entry.target ?? ''}
                          {entry.target && entry.guest_name ? ' · ' : ''}
                          {entry.guest_name ?? ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* The table is the one genuinely wide thing on the page, so it
                 scrolls inside itself rather than dragging the page with it. */
              <div className="table-scroll">
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
                        <td className="audit-when">
                          {entry.created_at.replace('T', ' ').slice(0, 16)}
                        </td>
                        <td>
                          {entry.staff_name ?? '—'}
                          {entry.staff_role && (
                            <span className="audit-role">{ROLE_LABELS[entry.staff_role]}</span>
                          )}
                        </td>
                        <td>{describeAudit(entry)}</td>
                        <td>
                          {entry.target ?? (entry.entity_id ? `#${entry.entity_id}` : '—')}
                          {entry.guest_name && (
                            <span className="audit-guest">{entry.guest_name}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
