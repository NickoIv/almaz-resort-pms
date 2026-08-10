import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Alert, Modal } from './ui'
import type { StaffMember } from '../types'

/**
 * Records one instalment against a booking; the API adds it to the prepaid total.
 *
 * Two fields exist because of one problem: the money and the record of it were
 * getting separated. Only an admin can enter a payment, but the admin is often
 * not who the guest handed the cash to, and the method used to default to cash
 * whenever nobody touched the selector — so a Kaspi transfer could be filed as
 * notes in a till that never saw them. Both are now stated outright.
 */
export default function PaymentModal({
  bookingId,
  onClose,
  onSaved,
}: {
  bookingId: number
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()

  const [amount, setAmount] = useState('')
  // No pre-selected method. The whole point is that the answer is given rather
  // than inherited from whatever happened to be first in the list.
  const [method, setMethod] = useState('')
  const [receivedBy, setReceivedBy] = useState<string>(String(user?.id ?? ''))
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // A failure here is not worth blocking the payment over: the field falls
    // back to the signed-in admin, which is the common case anyway.
    api<StaffMember[]>('/staff')
      .then((rows) => setStaff(rows.filter((member) => member.is_active)))
      .catch(() => setStaff([]))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api(`/bookings/${bookingId}/payment`, {
        method: 'PATCH',
        body: {
          payment: {
            amount: Number(amount),
            method,
            received_by: Number(receivedBy) || undefined,
          },
        },
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
          <select
            id="method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            required
          >
            <option value="" disabled>
              Выберите способ
            </option>
            <option value="cash">Наличные</option>
            <option value="card">Карта</option>
            <option value="kaspi">Kaspi</option>
            <option value="transfer">Перевод</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="received-by">Кто принял деньги</label>
          <select
            id="received-by"
            value={receivedBy}
            onChange={(event) => setReceivedBy(event.target.value)}
          >
            {staff.length === 0 && user && <option value={user.id}>{user.name}</option>}
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <div className="field-hint">
            По умолчанию — вы. Поменяйте, если деньги взял кто-то другой: официант у беседки,
            например. Запись останется в истории оплат.
          </div>
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
