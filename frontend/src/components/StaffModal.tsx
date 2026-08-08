import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'
import { ROLE_LABELS, type Role, type StaffMember } from '../types'

const ROLES: Role[] = ['admin', 'housekeeper', 'waiter']

const ROLE_HINTS: Record<Role, string> = {
  admin: 'Полный доступ: брони, оплаты, аналитика, настройки',
  housekeeper: 'Только чек-листы уборки. Суммы не видит',
  waiter: 'Только зона отдыха. Суммы не видит',
}

type Props = {
  /** Omitted when adding someone new. */
  member?: StaffMember
  onClose: () => void
  onSaved: () => void
}

/** Add a staff member, or edit one (name, role, PIN reset) in place. */
export default function StaffModal({ member, onClose, onSaved }: Props) {
  const editing = !!member

  const [name, setName] = useState(member?.name ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [role, setRole] = useState<Role>(member?.role ?? 'housekeeper')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (editing) {
        await api(`/staff/${member.id}`, {
          method: 'PATCH',
          // An empty PIN field means "leave the current PIN alone".
          body: { name, role, ...(pin ? { pin } : {}) },
        })
      } else {
        await api('/staff', { method: 'POST', body: { name, phone, role, pin } })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={editing ? `Сотрудник · ${member.name}` : 'Новый сотрудник'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert>{error}</Alert>}

        <div className="field">
          <label htmlFor="staff-name">Имя</label>
          <input
            id="staff-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Имя и фамилия"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <label htmlFor="staff-phone">Телефон</label>
          <input
            id="staff-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+7 701 111 22 33"
            required
            disabled={editing}
          />
          {editing && (
            <div className="field-hint">
              Телефон — логин, он не меняется. Заведите новую учётную запись, если номер другой.
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="staff-role">Роль</label>
          <select
            id="staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {ROLE_LABELS[item]}
              </option>
            ))}
          </select>
          <div className="field-hint">{ROLE_HINTS[role]}</div>
        </div>

        <div className="field">
          <label htmlFor="staff-pin">{editing ? 'Новый PIN (необязательно)' : 'PIN'}</label>
          <input
            id="staff-pin"
            className="pin-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="••••"
            required={!editing}
          />
          <div className="field-hint">
            4–8 цифр.{' '}
            {editing
              ? 'Оставьте пустым, чтобы не менять текущий PIN.'
              : 'Передайте сотруднику лично — восстановить его нельзя, только задать новый.'}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : editing ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
