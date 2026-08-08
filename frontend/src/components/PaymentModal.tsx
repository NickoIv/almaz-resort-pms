import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'

/** Records one instalment against a booking; the API adds it to the prepaid total. */
export default function PaymentModal({
  bookingId,
  onClose,
  onSaved,
}: {
  bookingId: number
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api(`/bookings/${bookingId}/payment`, {
        method: 'PATCH',
        body: { payment: { amount: Number(amount), method } },
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось внести оплату')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Внести оплату" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert>{error}</Alert>}

        <div className="field">
          <label htmlFor="amount">Сумма</label>
          <input
            id="amount"
            type="number"
            min="1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="method">Способ оплаты</label>
          <select id="method" value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="cash">Наличные</option>
            <option value="card">Карта</option>
            <option value="kaspi">Kaspi</option>
            <option value="transfer">Перевод</option>
          </select>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Внести'}
          </button>
        </div>
      </form>
    </Modal>
  )
}