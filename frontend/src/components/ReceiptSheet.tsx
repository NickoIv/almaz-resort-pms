import { useEffect, useState } from 'react'
import { api } from '../api'
import { Spinner } from './ui'
import { dateRange, money, timeRange } from '../format'
import { CANCEL_REASON_LABELS, type CancelReason } from '../cancellation'
import { UNIT_TYPE_LABELS, type Booking, type Charge, type Payment, type Unit } from '../types'

type TextSettings = { hotel_name: string; hotel_details: string }

/**
 * Check-out receipt / акт.
 *
 * Printed through the browser, like the housekeeping sheet — "Сохранить как
 * PDF" in the print dialog produces the file, so there is no PDF library and
 * nothing extra to keep in step with the app's formatting.
 *
 * The deposit is listed apart from the totals on purpose: it is a refundable
 * hold, and folding it into "к оплате" is exactly the confusion this project
 * has been avoiding everywhere else.
 */
export default function ReceiptSheet({
  unit,
  booking,
  charges,
  payments,
  onClose,
}: {
  unit: Unit
  booking: Booking
  charges: Charge[]
  payments: Payment[]
  onClose: () => void
}) {
  const [hotel, setHotel] = useState<TextSettings>({ hotel_name: 'Almaz Resort', hotel_details: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ text: TextSettings }>('/settings')
      .then((data) => setHotel(data.text))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const currency = booking.currency ?? 'KZT'
  const rate = booking.total_amount ?? 0
  const chargesTotal = charges.reduce((sum, charge) => sum + charge.amount, 0)
  const billed = rate + chargesTotal
  const paid = booking.prepaid_amount ?? 0
  const remaining = billed - paid
  const deposit = booking.deposit_amount ?? 0
  const isRoom = unit.type === 'room'

  return (
    <div className="sheet-overlay">
      <div className="sheet-toolbar no-print">
        <button className="btn btn-sm btn-primary" onClick={() => window.print()} disabled={loading}>
          Печать
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Закрыть
        </button>
        <span className="field-hint">
          «Сохранить как PDF» в диалоге печати — чтобы отправить гостю файлом.
        </span>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="print-sheet receipt">
          <header className="sheet-head">
            <h1>{hotel.hotel_name}</h1>
            {hotel.hotel_details && <div className="sheet-meta">{hotel.hotel_details}</div>}
            <div className="receipt-title">
              Счёт-акт по брони №{booking.id}
              {booking.cancel_reason && booking.cancel_reason !== 'checked_out' && (
                <span className="receipt-void">
                  {' '}
                  · {CANCEL_REASON_LABELS[booking.cancel_reason as CancelReason] ?? ''}
                </span>
              )}
            </div>
          </header>

          <section className="receipt-grid">
            <div>
              <div className="receipt-label">Гость</div>
              <div className="receipt-value">{booking.guest_name}</div>
              {booking.guest_phone && <div className="receipt-sub">{booking.guest_phone}</div>}
            </div>
            <div>
              <div className="receipt-label">Объект</div>
              <div className="receipt-value">
                {isRoom ? `Номер ${unit.name}` : unit.name}
              </div>
              <div className="receipt-sub">{UNIT_TYPE_LABELS[unit.type]}</div>
            </div>
            <div>
              <div className="receipt-label">{isRoom ? 'Заезд — выезд' : 'Период'}</div>
              <div className="receipt-value">
                {isRoom
                  ? dateRange(booking.date_from, booking.date_to)
                  : timeRange(booking.date_from, booking.date_to)}
              </div>
            </div>
          </section>

          <table className="receipt-table">
            <thead>
              <tr>
                <th>Наименование</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{isRoom ? 'Проживание' : 'Аренда'}</td>
                <td className="num">{money(rate, currency)}</td>
              </tr>
              {charges.map((charge) => (
                <tr key={charge.id}>
                  <td>
                    {charge.reason}
                    <span className="receipt-sub">доп. начисление</span>
                  </td>
                  <td className="num">{money(charge.amount, currency)}</td>
                </tr>
              ))}
              <tr className="receipt-total">
                <td>Итого начислено</td>
                <td className="num">{money(billed, currency)}</td>
              </tr>
              <tr>
                <td>Оплачено</td>
                <td className="num">{money(paid, currency)}</td>
              </tr>
              <tr className="receipt-total">
                <td>{remaining > 0 ? 'К доплате' : 'К возврату / остаток'}</td>
                <td className="num">{money(Math.abs(remaining), currency)}</td>
              </tr>
            </tbody>
          </table>

          {deposit > 0 && (
            <div className="receipt-deposit">
              <strong>Депозит: {money(deposit, currency)}</strong> — возвратный, не входит в сумму
              начислений. Возвращается при отсутствии повреждений.
            </div>
          )}

          {payments.length > 0 && (
            <section className="receipt-payments">
              <div className="receipt-label">Платежи</div>
              <table className="receipt-table">
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        {payment.paid_at.slice(0, 16).replace('T', ' ')} · {payment.method}
                      </td>
                      <td className="num">{money(payment.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <footer className="receipt-sign">
            <div>Гость: ____________________</div>
            <div>Администратор: ____________________</div>
            <div>Дата: __________</div>
          </footer>
        </div>
      )}
    </div>
  )
}
