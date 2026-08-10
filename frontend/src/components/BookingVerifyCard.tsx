import { useState } from 'react'
import { api } from '../api'
import { Alert } from './ui'
import { dateRange, daysBetween, money, pluralRu, timeRange } from '../format'
import {
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  UNIT_TYPE_LABELS,
  type Booking,
  type UnitType,
} from '../types'

type Props = {
  booking: Booking
  unitName?: string
  unitType: UnitType
  /** Recreation units are sold by the hour, so the stay reads as a clock range. */
  hourly: boolean
  canSeeMoney: boolean
  /** What was chosen in the form. The created booking carries the amount, not
      the method — the method lives on the payment row the server just wrote. */
  paymentMethod?: string
  receivedByName?: string
  onFix: () => void
  onDone: () => void
}

/**
 * The booking, read back.
 *
 * A booking is typed in one pass with the guest still on the phone, and every
 * field in it is a number or a date that looks plausible when it is wrong: the
 * room next to the one that was free, a checkout a day early, a prepayment with
 * a digit missing. None of that announces itself — it surfaces on arrival day,
 * in front of the guest.
 *
 * So the form does not simply vanish on save. It shows what was written, in
 * words rather than in the inputs that produced it (a date input re-reads as the
 * same thing whether or not it is what was meant), and asks for one deliberate
 * press. «Проверено» is recorded against the person who pressed it, because
 * "nobody checked this" and "someone checked it and missed it" are different
 * problems.
 *
 * Closing the card without pressing is allowed. The booking is already saved —
 * trapping someone in a dialog would only teach them to press the button
 * without reading, which is the one outcome that makes the record worse than
 * having none.
 */
export default function BookingVerifyCard({
  booking,
  unitName,
  unitType,
  hourly,
  canSeeMoney,
  paymentMethod,
  receivedByName,
  onFix,
  onDone,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = booking.date_from ?? ''
  const to = booking.date_to ?? ''
  const nights = !hourly && from && to ? daysBetween(from, to) : 0

  const currency = booking.currency ?? 'KZT'
  const prepaid = booking.prepaid_amount ?? 0
  const remaining = booking.remaining_amount ?? 0

  async function confirm() {
    setSaving(true)
    setError(null)
    try {
      await api(`/bookings/${booking.id}/verify`, { method: 'POST' })
      onDone()
    } catch (err) {
      // The check failing must not strand a booking that is already saved.
      setError(err instanceof Error ? err.message : 'Не удалось отметить проверку')
      setSaving(false)
    }
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}

      <div className="notice">
        Бронь #{booking.id} сохранена. Сверьте её с тем, что просил гость, и
        подтвердите — отметка сохранится с вашим именем.
      </div>

      <div className="info-rows verify-facts">
        <div className="info-row">
          <span>Объект</span>
          <span>{unitName ?? UNIT_TYPE_LABELS[unitType]}</span>
        </div>
        <div className="info-row">
          <span>Гость</span>
          <span>{booking.guest_name || '—'}</span>
        </div>
        <div className="info-row">
          <span>Телефон</span>
          <span>{booking.guest_phone || 'не указан'}</span>
        </div>
        <div className="info-row">
          <span>{hourly ? 'Время' : 'Даты'}</span>
          <span>
            {hourly ? timeRange(from, to) : dateRange(from, to)}
            {nights > 0 && ` · ${nights} ${pluralRu(nights, ['ночь', 'ночи', 'ночей'])}`}
          </span>
        </div>
        <div className="info-row">
          <span>Статус</span>
          <span>{booking.status ? STATUS_LABELS[booking.status] : '—'}</span>
        </div>

        {canSeeMoney && (
          <>
            <div className="info-row">
              <span>Сумма</span>
              <span>{money(booking.total_amount, currency)}</span>
            </div>
            <div className="info-row">
              <span>Предоплата</span>
              <span>
                {money(prepaid, currency)}
                {/* Only when money actually changed hands: on a booking with no
                    prepayment there is no method and no taker to name. */}
                {prepaid > 0 && paymentMethod && (
                  <>
                    {' · '}
                    {PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod}
                    {receivedByName ? `, принял(а) ${receivedByName}` : ''}
                  </>
                )}
              </span>
            </div>
            {(booking.deposit_amount ?? 0) > 0 && (
              <div className="info-row">
                <span>Депозит</span>
                <span>{money(booking.deposit_amount, currency)}</span>
              </div>
            )}
            <div className="info-row verify-remaining">
              <span>К оплате</span>
              <span className={remaining > 0 ? 'money-due' : undefined}>
                {money(remaining, currency)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onFix} disabled={saving}>
          Исправить
        </button>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={saving}>
          {saving ? 'Сохранение…' : 'Проверено'}
        </button>
      </div>
    </>
  )
}
