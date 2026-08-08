import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'
import {
  CURRENCIES,
  CURRENCY_LABELS,
  DEFAULT_CURRENCY,
  UNIT_TYPE_LABELS,
  type Currency,
  type Unit,
} from '../types'

const DURATIONS = [1, 2, 3, 4, 6, 8, 12]

/**
 * Quick-booking for waiters: seat a guest right now with nothing but a name
 * and a duration. The server stamps the start time and works out the end.
 */
export default function QuickBookModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: Unit
  onClose: () => void
  onSaved: () => void
}) {
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [hours, setHours] = useState(3)
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api('/bookings/quick', {
        method: 'POST',
        body: {
          unit_id: unit.id,
          guest_name: guestName,
          guest_phone: guestPhone || null,
          hours,
          currency,
        },
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось забронировать')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`${UNIT_TYPE_LABELS[unit.type]} «${unit.name}» — сейчас`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert>{error}</Alert>}

        <div className="field">
          <label htmlFor="quick-guest">Гость</label>
          <input
            id="quick-guest"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Имя гостя"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <label htmlFor="quick-phone">Телефон (необязательно)</label>
          <input
            id="quick-phone"
            type="tel"
            value={guestPhone}
            onChange={(event) => setGuestPhone(event.target.value)}
            placeholder="+7 …"
          />
        </div>

        <div className="field">
          <label>На сколько часов</label>
          <div className="chip-row">
            {DURATIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${hours === value ? 'active' : ''}`}
                onClick={() => setHours(value)}
              >
                {value} ч
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="quick-currency">Валюта</label>
          <select
            id="quick-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {CURRENCY_LABELS[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Бронирую…' : `Занять на ${hours} ч`}
          </button>
        </div>
      </form>
    </Modal>
  )
}