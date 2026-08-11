import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'
import { money } from '../format'
import type { Booking } from '../types'

type Props = {
  booking: Booking
  onClose: () => void
  onSaved: () => void
}

/**
 * Вернуть залог.
 *
 * The deposit has been stored and shown as «возвратный, не входит в остаток»
 * since the beginning, and nothing ever recorded that it went back — so at the
 * end of a shift nobody could answer «вернули ли те 5 000?». The figure simply
 * sat on the booking for ever, which is the one thing a refundable hold must
 * never do.
 *
 * The form opens with the whole amount already filled in, because that is what
 * happens almost every time. Typing a smaller figure is the exception, and the
 * screen then insists on a reason: «удержано 5 000» with nothing beside it is
 * the start of an argument nobody can settle a week later.
 */
export default function DepositModal({ booking, onClose, onSaved }: Props) {
  const held = booking.deposit_amount ?? 0
  const [amount, setAmount] = useState(String(held))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const returning = Number(amount || 0)
  const withheld = Number((held - returning).toFixed(2))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api(`/bookings/${booking.id}/deposit-return`, {
        method: 'POST',
        body: { amount: returning, note: note || null },
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось записать возврат')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Возврат залога" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <Alert>{error}</Alert>}

        <div className="notice">
          Гость оставлял <strong>{money(held, booking.currency)}</strong>. Это запись о том, что
          деньги вернули — она не меняет остаток по броне.
        </div>

        <div className="field">
          <label htmlFor="deposit-amount">Возвращаем</label>
          <input
            id="deposit-amount"
            type="number"
            min="0"
            max={held}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </div>

        {/* Withholding is the exception, so it is explained only when it is
            happening — and then the money is followed all the way through
            rather than left as a smaller number in a text field. */}
        {withheld > 0 && (
          <>
            <div className="field">
              <label htmlFor="deposit-note">За что удерживаем</label>
              <input
                id="deposit-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Разбито зеркало в ванной"
                required
              />
            </div>
            <div className="notice notice-warn">
              Удерживается <strong>{money(withheld, booking.currency)}</strong> — эта сумма пойдёт в
              начисления по броне с этой же формулировкой и сразу будет закрыта: гость уже отдал
              деньги при заезде, второй раз платить не должен.
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : withheld > 0 ? 'Вернуть часть' : 'Вернуть залог'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
