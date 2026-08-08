import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal, Spinner } from './ui'
import { addDaysIso, money, todayIso } from '../format'
import { UNIT_TYPE_LABELS, type Unit, type UnitType } from '../types'

const GROUPS: { type: UnitType; label: string }[] = [
  { type: 'room', label: 'Номера' },
  { type: 'sunbed', label: 'Топчаны' },
  { type: 'gazebo', label: 'Беседки' },
  { type: 'vip_gazebo', label: 'VIP-беседки' },
]

/**
 * Books several units at once under one event name. Each unit still gets its
 * own booking, so the calendars and cleaning flow are unchanged; the event
 * price is split across them and can be paid off with one combined payment.
 */
export default function GroupBookingModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number[]>([])

  const [name, setName] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [dateFrom, setDateFrom] = useState(todayIso())
  const [dateTo, setDateTo] = useState(addDaysIso(todayIso(), 1))
  const [total, setTotal] = useState('')
  const [deposit, setDeposit] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api<Unit[]>('/units')
      .then(setUnits)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const perUnit = useMemo(() => {
    const value = Number(total || 0)
    return selected.length > 0 ? value / selected.length : 0
  }, [total, selected.length])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (selected.length < 2) {
      setError('Выберите минимум два объекта — иначе это обычная бронь')
      return
    }

    setSaving(true)
    try {
      await api('/bookings/group', {
        method: 'POST',
        body: {
          unit_ids: selected,
          name,
          guest_name: guestName,
          guest_phone: guestPhone || null,
          date_from: dateFrom,
          date_to: dateTo,
          total_amount: Number(total || 0),
          deposit_amount: Number(deposit || 0),
          status: 'booked',
        },
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать групповую бронь')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Групповая бронь" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert>{error}</Alert>}

        <div className="field">
          <label htmlFor="g-name">Название мероприятия</label>
          <input
            id="g-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Свадьба Ерлана"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="g-guest">Организатор</label>
          <input
            id="g-guest"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Имя и фамилия"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="g-phone">Телефон</label>
          <input
            id="g-phone"
            type="tel"
            value={guestPhone}
            onChange={(event) => setGuestPhone(event.target.value)}
            placeholder="+7 …"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="g-from">Начало</label>
            <input
              id="g-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="g-to">Окончание</label>
            <input
              id="g-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="field">
          <label>
            Объекты{' '}
            <span className="field-hint">
              выбрано {selected.length}
              {selected.length > 0 && perUnit > 0 && ` · по ${money(Math.round(perUnit))} на объект`}
            </span>
          </label>

          {loading ? (
            <Spinner />
          ) : (
            <div className="picker">
              {GROUPS.map((section) => {
                const sectionUnits = units.filter((unit) => unit.type === section.type)
                if (sectionUnits.length === 0) return null
                return (
                  <div key={section.type} className="picker-section">
                    <div className="picker-title">{section.label}</div>
                    <div className="picker-grid">
                      {sectionUnits.map((unit) => {
                        const busy = unit.status !== 'free'
                        return (
                          <button
                            key={unit.id}
                            type="button"
                            className={`picker-item ${selected.includes(unit.id) ? 'active' : ''} ${
                              busy ? 'busy' : ''
                            }`}
                            onClick={() => toggle(unit.id)}
                            title={
                              busy
                                ? `Сейчас ${UNIT_TYPE_LABELS[unit.type].toLowerCase()} занят — проверьте даты`
                                : undefined
                            }
                          >
                            {unit.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="g-total">Сумма за мероприятие</label>
            <input
              id="g-total"
              type="number"
              min="0"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label htmlFor="g-deposit">Депозит</label>
            <input
              id="g-deposit"
              type="number"
              min="0"
              value={deposit}
              onChange={(event) => setDeposit(event.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Создание…' : `Забронировать ${selected.length || ''}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}