import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import StaffModal from '../components/StaffModal'
import { Alert, EmptyState, Spinner } from '../components/ui'
import { ROLE_LABELS, type Role, type StaffMember } from '../types'

const ROLE_ORDER: Role[] = ['admin', 'housekeeper', 'waiter']

export default function StaffPage() {
  const { user } = useAuth()

  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<StaffMember[]>('/staff')
      .then(setStaff)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  async function patch(member: StaffMember, body: Record<string, unknown>, message: string) {
    setBusyId(member.id)
    setError(null)
    setNotice(null)
    try {
      await api(`/staff/${member.id}`, { method: 'PATCH', body })
      setNotice(message)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusyId(null)
    }
  }

  function resetPin(member: StaffMember) {
    const pin = window.prompt(`Новый PIN для «${member.name}» (4–8 цифр):`)
    if (pin === null) return
    if (!/^\d{4,8}$/.test(pin)) {
      setError('PIN должен состоять из 4–8 цифр')
      return
    }
    void patch(member, { pin }, `PIN для «${member.name}» изменён. Передайте его лично.`)
  }

  function toggleActive(member: StaffMember) {
    const turningOff = member.is_active
    if (turningOff && !window.confirm(`Отключить доступ для «${member.name}»?`)) return
    void patch(
      member,
      { is_active: !member.is_active },
      turningOff ? `«${member.name}» отключён` : `«${member.name}» снова активен`
    )
  }

  const active = staff.filter((s) => s.is_active).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Персонал</h1>
          <div className="page-sub">
            {staff.length} учётных записей · {active} активных
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            Добавить сотрудника
          </button>
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <div className="notice">{notice}</div>}

      {loading ? (
        <Spinner />
      ) : staff.length === 0 ? (
        <EmptyState icon="👤">Сотрудников пока нет</EmptyState>
      ) : (
        <div className="staff-list">
          {ROLE_ORDER.map((role) => {
            const group = staff.filter((member) => member.role === role)
            if (group.length === 0) return null

            return (
              <section className="panel glass" key={role}>
                <div className="panel-title">
                  {ROLE_LABELS[role]}
                  <span className="count">{group.length}</span>
                </div>

                <div className="staff-rows">
                  {group.map((member) => {
                    const isSelf = member.id === user?.id
                    return (
                      <div
                        key={member.id}
                        className={`staff-row ${member.is_active ? '' : 'is-disabled'}`}
                      >
                        <div className="staff-identity">
                          <div className="staff-name">
                            {member.name}
                            {isSelf && <span className="tag">это вы</span>}
                            {!member.is_active && <span className="tag tag-off">отключён</span>}
                          </div>
                          <div className="staff-phone">{member.phone}</div>
                        </div>

                        <div className="staff-actions">
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setEditing(member)}
                            disabled={busyId === member.id}
                          >
                            Изменить
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => resetPin(member)}
                            disabled={busyId === member.id}
                          >
                            Сбросить PIN
                          </button>
                          <button
                            className={`btn btn-sm ${member.is_active ? 'btn-danger' : ''}`}
                            onClick={() => toggleActive(member)}
                            // The API refuses this too; disabling the button
                            // explains why before the click.
                            disabled={busyId === member.id || (isSelf && member.is_active)}
                            title={
                              isSelf && member.is_active
                                ? 'Нельзя отключить собственную учётную запись'
                                : undefined
                            }
                          >
                            {member.is_active ? 'Отключить' : 'Включить'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {adding && <StaffModal onClose={() => setAdding(false)} onSaved={load} />}
      {editing && (
        <StaffModal member={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </>
  )
}
