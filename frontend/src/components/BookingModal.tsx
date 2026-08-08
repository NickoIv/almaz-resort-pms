import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'
import { addDaysIso, todayIso } from '../format'
import { CANCEL_REASONS, CANCEL_REASON_LABELS, needsNote, type CancelReason } from '../cancellation'
import {
  CURRENCIES,
  CURRENCY_LABELS,
  DEFAULT_CURRENCY,
  type Booking,
  type Currency,
  type UnitStatus,
} from '../types'

type Props = {
  unitId: number
  booking: Booking | null
  canSetPrice: boolean
  /** Recreation units are sold by the hour, so the form switches to date+time. */
  hourly?: boolean
  onClose: () => void
  onSaved: () => void
}

/** `2026-08-08 14:00` <-> the `datetime-local` input's `2026-08-08T14:00`. */
function toInput(value: string | null | undefined, hourly: boolean, fallback: string): string {
  if (!value) return fallback
  return hourly ? value.slice(0, 16).replace(' ', 'T') : value.slice(0, 10)
}

function toApi(value: string, hourly: boolean): string {
  return hourly ? value.replace('T', ' ').slice(0, 16) : value.slice(0, 10)
}

/** Create or edit a booking. Money fields only appear for the admin. */
export default function BookingModal({
  unitId,
  booking,
  canSetPrice,
  hourly = false,
  onClose,
  onSaved,
}: Props) {
  const defaultFrom = hourly ? `${todayIso()}T12:00` : todayIso()
  const defaultTo = hourly ? `${todayIso()}T16:00` : addDaysIso(todayIso(), 1)

  const [guestName, setGuestName] = useState(booking?.guest_name ?? '')
  const [guestPhone, setGuestPhone] = useState(booking?.guest_phone ?? '')
  const [dateFrom, setDateFrom] = useState(toInput(booking?.date_from, hourly, defaultFrom))
  const [dateTo, setDateTo] = useState(toInput(booking?.date_to, hourly, defaultTo))
  const [status, setStatus] = useState<UnitStatus>(booking?.status ?? 'booked')
  const [total, setTotal] = useState(String(booking?.total_amount ?? ''))
  const [prepaid, setPrepaid] = useState(String(booking?.prepaid_amount ?? ''))
  const [deposit, setDeposit] = useState(String(booking?.deposit_amount ?? ''))
  const [currency, setCurrency] = useState<Currency>(
    (booking?.currency as Currency) ?? DEFAULT_CURRENCY
  )

  const [cancelReason, setCancelReason] = useState<CancelReason>('checked_out')
  const [cancelNote, setCancelNote] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Going to 'free' from an active booking is either a checkout or a
  // cancellation; the API requires a reason to tell them apart.
  const ending = !!booking && booking.status !== 'free' && status === 'free'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        guest_name: guestName,
        guest_phone: guestPhone || null,
        date_from: toApi(dateFrom, hourly),
        date_to: toApi(dateTo, hourly),
        status,
        ...(ending ? { cancel_reason: cancelReason, cancel_note: cancelNote || null } : {}),
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
              currency,
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
                  currency,
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
            <label htmlFor="from">{hourly ? 'Начало' : 'Заезд'}</label>
            <input
              id="from"
              type={hourly ? 'datetime-local' : 'date'}
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="to">{hourly ? 'Окончание' : 'Выезд'}</label>
            <input
              id="to"
              type={hourly ? 'datetime-local' : 'date'}
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

        {ending && (
          <div className="cancel-block">
            <div className="field">
              <label htmlFor="cancel-reason">Причина завершения</label>
              <select
                id="cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value as CancelReason)}
              >
                {CANCEL_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {CANCEL_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cancel-note">
                Комментарий{needsNote(cancelReason) ? '' : ' (необязательно)'}
              </label>
              <input
                id="cancel-note"
                value={cancelNote}
                onChange={(event) => setCancelNote(event.target.value)}
                placeholder={needsNote(cancelReason) ? 'Опишите причину' : ''}
                required={needsNote(cancelReason)}
              />
            </div>
          </div>
        )}

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
            <div className="field-row">
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
              <div className="field">
                <label htmlFor="currency">Валюта</label>
                <select
                  id="currency"
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