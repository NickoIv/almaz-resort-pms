import { useEffect, useState } from 'react'
import { api } from '../api'
import { Spinner } from './ui'
import { daysBetween, money, pluralRu, shortDate, timeRange, todayIso } from '../format'
import { CANCEL_REASON_LABELS, type CancelReason } from '../cancellation'
import {
  PAYMENT_METHOD_LABELS,
  UNIT_TYPE_LABELS,
  type Booking,
  type Charge,
  type Payment,
  type UnitType,
} from '../types'

type TextSettings = {
  hotel_name: string
  hotel_details: string
  invoice_legal_name: string
  invoice_tax_id: string
  invoice_legal_address: string
  invoice_contact: string
  invoice_bank: string
  invoice_terms: string
  vat_registered: string
  vat_rate: string
  vat_prices_include: string
}

const EMPTY: TextSettings = {
  hotel_name: 'Taura',
  hotel_details: '',
  invoice_legal_name: '',
  invoice_tax_id: '',
  invoice_legal_address: '',
  invoice_contact: '',
  invoice_bank: '',
  invoice_terms: '',
  vat_registered: '0',
  vat_rate: '16',
  vat_prices_include: '1',
}

/**
 * The invoice number.
 *
 * Derived from the booking id rather than being a counter of its own, because a
 * counter would have to be stored, and two admins printing at once would either
 * collide on a number or burn one. The booking id is already unique, already
 * permanent, and reprinting the same stay gives the same number — which is what
 * anyone matching a payment to a document actually needs.
 */
function invoiceNumber(booking: Booking): string {
  const year = (booking.date_from ?? todayIso()).slice(0, 4)
  return `${year}-${String(booking.id).padStart(5, '0')}`
}

/**
 * A hotel invoice, in the shape the chains use.
 *
 * What makes this an invoice rather than the till receipt it replaces: it is
 * addressed (there is a "bill to" and an issuer with legal details), it is
 * numbered and dated, the stay is itemised **per night with a rate** rather than
 * as one lump called "проживание", and it ends in an amount due with terms
 * under it. Those are the parts a guest's employer needs in order to reimburse
 * them, and the parts an accountant needs in order to file it.
 *
 * Every legal line is omitted when its setting is blank. An invoice with a
 * fabricated BIN is worse than one with no BIN: the missing line is obvious to
 * whoever reads it, and the wrong one is not.
 */
export default function InvoiceSheet({
  unit,
  booking,
  charges,
  payments,
  onClose,
}: {
  unit: { name: string; type: UnitType }
  booking: Booking
  charges: Charge[]
  payments: Payment[]
  onClose: () => void
}) {
  const [text, setText] = useState<TextSettings>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ text: TextSettings }>('/settings')
      .then((data) => setText({ ...EMPTY, ...data.text }))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isRoom = unit.type === 'room'
  const currency = booking.currency ?? 'KZT'
  const from = booking.date_from ?? ''
  const to = booking.date_to ?? ''

  const nights = isRoom && from && to ? Math.max(1, daysBetween(from, to)) : 1
  const rate = booking.total_amount ?? 0
  // Per night, to the tenge. The remainder rides on the first night so the line
  // items add back up to the quoted total exactly — a rounded rate multiplied
  // out is the classic way an invoice fails to reconcile with itself.
  const perNight = Math.floor(rate / nights)
  const firstNight = rate - perNight * (nights - 1)

  const chargesTotal = charges.reduce((sum, charge) => sum + charge.amount, 0)
  const billed = rate + chargesTotal

  /**
   * НДС, when the hotel is registered for it.
   *
   * Two ways round, and the difference is whether the total moves:
   *
   *   - **цены с НДС** — the figures already contain the tax, so the total is
   *     untouched and the invoice states «в том числе НДС», which is what a
   *     company's accountant needs in order to reclaim it;
   *   - **цены без НДС** — the figures are net, the tax is added, and the
   *     amount due goes up by exactly that.
   *
   * Off by default: with `vat_registered` unset the invoice prints exactly as
   * it did before any of this existed.
   */
  const vatRate = Number(text.vat_rate || 0)
  const vatOn = text.vat_registered === '1' && vatRate > 0
  const vatIncluded = text.vat_prices_include !== '0'
  const vat = !vatOn
    ? 0
    : vatIncluded
      ? Math.round((billed * vatRate) / (100 + vatRate))
      : Math.round((billed * vatRate) / 100)
  // Only the "added" case moves the total; "included" already contains it.
  const grand = vatOn && !vatIncluded ? billed + vat : billed

  const paid = booking.prepaid_amount ?? 0
  const due = grand - paid
  const deposit = booking.deposit_amount ?? 0

  const issuer = [
    text.invoice_legal_name,
    text.invoice_tax_id && `БИН/ИИН ${text.invoice_tax_id}`,
    text.invoice_legal_address,
    text.invoice_contact,
  ].filter(Boolean)

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      {/* Stops a click inside the paper from closing it — the backdrop is a
          close affordance, the sheet is not. */}
      <div onClick={(event) => event.stopPropagation()}>
        <div className="sheet-toolbar no-print">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => window.print()}
            disabled={loading}
          >
            Печать
          </button>
          <button className="btn btn-sm" onClick={onClose}>
            Закрыть
          </button>
          <span className="field-hint">
            «Сохранить как PDF» в диалоге печати — чтобы отправить файлом. Esc тоже закрывает.
          </span>
        </div>

        {loading ? (
          <Spinner />
        ) : (
          <div className="print-sheet invoice">
            <header className="invoice-head">
              <div>
                <h1>{text.hotel_name}</h1>
                {text.hotel_details && <div className="sheet-meta">{text.hotel_details}</div>}
                {issuer.length > 0 && (
                  <div className="invoice-issuer">
                    {issuer.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="invoice-id">
                <div className="invoice-word">Инвойс</div>
                <div className="invoice-no">№ {invoiceNumber(booking)}</div>
                <div className="receipt-sub">от {shortDate(todayIso())}</div>
                {booking.cancel_reason && booking.cancel_reason !== 'checked_out' && (
                  <div className="receipt-void">
                    {CANCEL_REASON_LABELS[booking.cancel_reason as CancelReason] ?? ''}
                  </div>
                )}
              </div>
            </header>

            <section className="receipt-grid">
              <div>
                <div className="receipt-label">Плательщик</div>
                <div className="receipt-value">{booking.guest_name || '—'}</div>
                {booking.guest_phone && <div className="receipt-sub">{booking.guest_phone}</div>}
              </div>
              <div>
                <div className="receipt-label">Объект</div>
                <div className="receipt-value">{isRoom ? `Номер ${unit.name}` : unit.name}</div>
                <div className="receipt-sub">{UNIT_TYPE_LABELS[unit.type]}</div>
              </div>
              <div>
                <div className="receipt-label">{isRoom ? 'Заезд — выезд' : 'Период'}</div>
                <div className="receipt-value">
                  {isRoom ? `${shortDate(from)} — ${shortDate(to)}` : timeRange(from, to)}
                </div>
                {isRoom && (
                  <div className="receipt-sub">
                    {nights} {pluralRu(nights, ['ночь', 'ночи', 'ночей'])}
                  </div>
                )}
              </div>
            </section>

            <table className="receipt-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th className="num">Кол-во</th>
                  <th className="num">Цена</th>
                  <th className="num">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {/* Itemised per night with a rate, not one lump called
                    "проживание": a rate is the thing a guest's employer checks
                    against a travel policy. */}
                <tr>
                  <td>
                    {isRoom ? 'Проживание' : 'Аренда'}
                    <span className="receipt-sub">
                      {isRoom ? `${shortDate(from)} — ${shortDate(to)}` : timeRange(from, to)}
                    </span>
                  </td>
                  <td className="num">{isRoom ? nights : 1}</td>
                  <td className="num">{money(isRoom ? perNight : rate, currency)}</td>
                  <td className="num">{money(rate, currency)}</td>
                </tr>
                {isRoom && nights > 1 && firstNight !== perNight && (
                  <tr className="invoice-note-row">
                    <td colSpan={4}>
                      <span className="receipt-sub">
                        Первая ночь — {money(firstNight, currency)}: остаток от деления
                        отнесён на неё, чтобы строки сходились с итогом.
                      </span>
                    </td>
                  </tr>
                )}
                {charges.map((charge) => (
                  <tr key={charge.id}>
                    <td>
                      {charge.reason}
                      <span className="receipt-sub">
                        дополнительное начисление · {shortDate(charge.created_at)}
                      </span>
                    </td>
                    <td className="num">1</td>
                    <td className="num">{money(charge.amount, currency)}</td>
                    <td className="num">{money(charge.amount, currency)}</td>
                  </tr>
                ))}
                <tr className={vatOn && !vatIncluded ? '' : 'receipt-total'}>
                  <td colSpan={3}>
                    {vatOn && !vatIncluded ? 'Итого без НДС' : 'Итого начислено'}
                  </td>
                  <td className="num">{money(billed, currency)}</td>
                </tr>
                {vatOn && (
                  <tr>
                    <td colSpan={3}>
                      {vatIncluded ? `В том числе НДС ${vatRate}%` : `НДС ${vatRate}%`}
                    </td>
                    <td className="num">{money(vat, currency)}</td>
                  </tr>
                )}
                {vatOn && !vatIncluded && (
                  <tr className="receipt-total">
                    <td colSpan={3}>Итого с НДС</td>
                    <td className="num">{money(grand, currency)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={3}>Оплачено</td>
                  <td className="num">{money(paid, currency)}</td>
                </tr>
                <tr className="receipt-total invoice-due">
                  <td colSpan={3}>{due >= 0 ? 'К оплате' : 'К возврату'}</td>
                  <td className="num">{money(Math.abs(due), currency)}</td>
                </tr>
              </tbody>
            </table>

            {deposit > 0 && (
              <div className="receipt-deposit">
                <strong>Депозит: {money(deposit, currency)}</strong> — возвратный, не входит в
                сумму начислений. Возвращается при отсутствии повреждений.
              </div>
            )}

            {payments.length > 0 && (
              <section className="receipt-payments">
                <div className="receipt-label">Поступившие платежи</div>
                <table className="receipt-table">
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          {payment.paid_at.slice(0, 16).replace('T', ' ')} ·{' '}
                          {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                          {payment.received_by_name && (
                            <span className="receipt-sub">
                              принял(а) {payment.received_by_name}
                            </span>
                          )}
                        </td>
                        <td className="num">{money(payment.amount, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {(text.invoice_bank || text.invoice_terms) && (
              <section className="invoice-terms">
                {text.invoice_bank && (
                  <div>
                    <div className="receipt-label">Реквизиты для оплаты</div>
                    <p>{text.invoice_bank}</p>
                  </div>
                )}
                {text.invoice_terms && (
                  <div>
                    <div className="receipt-label">Условия</div>
                    <p>{text.invoice_terms}</p>
                  </div>
                )}
              </section>
            )}

            <footer className="receipt-sign">
              <div>Плательщик: ____________________</div>
              <div>Администратор: ____________________</div>
              <div>Дата: __________</div>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}
