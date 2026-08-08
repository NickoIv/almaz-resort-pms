import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'

/** Common reasons, so the usual case is one tap rather than typing. */
const PRESETS = [
  'Испорченное имущество',
  'Поздний выезд',
  'Мини-бар',
  'Дополнительное место',
  'Курение в номере',
]

/** Attaches a penalty / extra charge to a booking, on top of the unit rate. */
export default function ChargeModal({
  bookingId,
  onClose,
  onSaved,
}: {
  bookingId: number
  onClose: () => void
  onSaved: () => void
}) {
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api(`/bookings/${bookingId}/charges`, {
        method: 'POST',
        body: { reason, amount: Number(amount) },
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить начисление')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Штраф / доп. начисление" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert>{error}</Alert>}

        <div className="field">
          <label htmlFor="charge-reason">Причина</label>
          <input
            id="charge-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="За что начисляется"
            required
          />
          <div className="chip-row" style={{ marginTop: 4 }}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`chip chip-sm ${reason === preset ? 'active' : ''}`}
                onClick={() => setReason(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="charge-amount">Сумма</label>
          <input
            id="charge-amount"
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            required
          />
          <div className="field-hint">
            Начисление добавляется к остатку и показывается отдельной строкой от стоимости
            проживания.
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Начислить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}