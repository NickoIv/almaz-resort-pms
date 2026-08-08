import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'
import { addDaysIso, todayIso } from '../format'
import type { Booking, UnitStatus } from '../types'

type Props = {
  unitId: number
  booking: Booking | null
  canSetPrice: boolean
  onClose: () => void
  onSaved: () => void
}

/** Create or edit a booking. Money fields only appear for the admin. */
export default function BookingModal({ unitId, booking, canSetPrice, onClose, onSaved }: Props) {
  const [guestName, setGuestName] = useState(booking?.guest_name ?? '')
  const [guestPhone, setGuestPhone] = useState(booking?.guest_phone ?? '')
  const [dateFrom, setDateFrom] = useState(booking?.date_from?.slice(0, 10) ?? todayIso())
  const [dateTo, setDateTo] = useState(booking?.date_to?.slice(0, 10) ?? addDaysIso(todayIso(), 1))
  const [status, setStatus] = useState<UnitStatus>(booking?.status ?? 'booked')
  const [total, setTotal] = useState(String(booking?.total_amount ?? ''))
  const [prepaid, setPrepaid] = useState(String(booking?.prepaid_amount ?? ''))
  const [deposit, setDeposit] = useState(String(booking?.deposit_amount ?? ''))

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        guest_name: guestName,
        guest_phone: guestPhone || null,
        date_from: dateFrom,
        date_to: dateTo,
        status,
      }

      if (booking) {
        await api(`/bookings/${booking.id}`, { method: 'PATCH', body: payload })
        // Dates/status and money live on separate endpoints, so save money after.
        if (canSetPrice) {
          await api(`/bookings/${booking.id}/payment`, {
            method: 'PATCH',
            body: {
              total_amount: Number(total || 0),
              prepaid_amount: Number(prepaid || 0),
              deposit_amount: Number(deposit || 0),
            },
          })
        }
      } else {
        await api('/bookings', {
          method: 'POST',
          body: {
            ...payload,
            unit_id: unitId,
            ...(canSetPrice
              ? {
                  total_amount: Number(total || 0),
                  prepaid_amount: Number(prepaid || 0),
                  deposit_amount: Number(deposit || 0),
                }
              : {}),
          },
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить бронь')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={booking ? `Бронь #${booking.id}` : 'Новая бронь'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert>{error}</Alert>}

        <div className="field">
          <label htmlFor="guest">Гость</label>
          <input
            id="guest"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Имя и фамилия"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="guest-phone">Телефон гостя</label>
          <input
            id="guest-phone"
            type="tel"
            value={guestPhone ?? ''}
            onChange={(event) => setGuestPhone(event.target.value)}
            placeholder="+7 …"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="from">Заезд</label>
            <input
              id="from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="to">Выезд</label>
            <input
              id="to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="status">Статус</label>
          <select
            id="status"
            value={status}
            onChange={(event) => setStatus(event.target.value as UnitStatus)}
          >
            <option value="booked">Забронирован</option>
            <option value="occupied">Заселён</option>
            <option value="free">Выехал / отменена</option>
          </select>
        </div>

        {canSetPrice && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="total">Сумма</label>
                <input
                  id="total"
                  type="number"
                  min="0"
                  value={total}
                  onChange={(event) => setTotal(event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label htmlFor="prepaid">Предоплата</label>
                <input
                  id="prepaid"
                  type="number"
                  min="0"
                  value={prepaid}
                  onChange={(event) => setPrepaid(event.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="deposit">Депозит / залог</label>
              <input
                id="deposit"
                type="number"
                min="0"
                value={deposit}
                onChange={(event) => setDeposit(event.target.value)}
                placeholder="0"
              />
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}