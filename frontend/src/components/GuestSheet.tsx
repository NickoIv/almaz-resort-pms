import { useEffect, useState } from 'react'
import { api } from '../api'
import { Spinner } from './ui'
import { dateRange, money, todayIso } from '../format'
import { STATUS_LABELS, UNIT_TYPE_LABELS, type GuestHistory } from '../types'

type TextSettings = { hotel_name: string; hotel_details: string }

/**
 * One guest, on paper: every stay they have had here, what they still owe, and
 * what the staff have written down about them.
 *
 * Internal, and it says so on the page. The notes are the reason — they are
 * written for colleagues ("шумный", "просит номер подальше от лифта") and
 * handing that to the person they are about would be a different document
 * entirely. The guest-facing sheet is the booking confirmation.
 */
export default function GuestSheet({
  data,
  onClose,
}: {
  data: GuestHistory
  onClose: () => void
}) {
  const [hotel, setHotel] = useState<TextSettings>({
    hotel_name: 'Taura',
    hotel_details: 'ул. Алма-Арасан, 4а, Алматы',
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ text: TextSettings }>('/settings')
      .then((settings) => setHotel(settings.text))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-overlay">
      <div className="sheet-toolbar no-print">
        <button className="btn btn-sm btn-primary" onClick={() => window.print()} disabled={loading}>
          Печать
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Закрыть
        </button>
        <span className="field-hint">Служебный лист — с заметками персонала. Гостю не отдаётся.</span>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="print-sheet">
          <header className="sheet-head">
            <h1>{hotel.hotel_name}</h1>
            {hotel.hotel_details && <div className="sheet-meta">{hotel.hotel_details}</div>}
            <div className="receipt-title">
              Карта гостя · {data.guest_name ?? 'без имени'}
              <span className="receipt-void"> · служебный документ</span>
            </div>
          </header>

          <section className="receipt-grid">
            <div>
              <div className="receipt-label">Гость</div>
              <div className="receipt-value">{data.guest_name ?? 'Неизвестный гость'}</div>
              <div className="receipt-sub">{data.phone}</div>
            </div>
            <div>
              <div className="receipt-label">Проживания</div>
              <div className="receipt-value">{data.total_stays}</div>
              <div className="receipt-sub">завершено {data.past_stays}</div>
            </div>
            <div>
              <div className="receipt-label">Оплачено всего</div>
              <div className="receipt-value">{money(data.lifetime_spend)}</div>
              {data.outstanding_debt > 0 && (
                <div className="receipt-sub">долг {money(data.outstanding_debt)}</div>
              )}
            </div>
          </section>

          {data.notes.trim() !== '' && (
            <section className="sheet-notes">
              <div className="receipt-label">Пожелания и заметки</div>
              <p>{data.notes}</p>
            </section>
          )}

          {data.stays.length === 0 ? (
            <p>Броней ещё не было.</p>
          ) : (
            <table className="receipt-table">
              <thead>
                <tr>
                  <th>Объект</th>
                  <th>Даты</th>
                  <th>Статус</th>
                  <th className="num">Начислено</th>
                  <th className="num">Оплачено</th>
                  <th className="num">Остаток</th>
                </tr>
              </thead>
              <tbody>
                {data.stays.map((stay) => (
                  <tr key={stay.booking_id}>
                    <td>
                      {stay.unit_name}
                      <span className="receipt-sub">{UNIT_TYPE_LABELS[stay.unit_type]}</span>
                    </td>
                    <td>
                      {dateRange(stay.date_from, stay.date_to)}
                      <span className="receipt-sub">бронь №{stay.booking_id}</span>
                    </td>
                    <td>{STATUS_LABELS[stay.status]}</td>
                    <td className="num">
                      {money(stay.total_amount + stay.charges_amount, stay.currency)}
                    </td>
                    <td className="num">{money(stay.prepaid_amount, stay.currency)}</td>
                    <td className="num">
                      {stay.remaining_amount > 0 ? money(stay.remaining_amount, stay.currency) : '—'}
                    </td>
                  </tr>
                ))}
                {data.outstanding_debt > 0 && (
                  <tr className="receipt-total">
                    <td colSpan={5}>Долг по всем броням</td>
                    <td className="num">{money(data.outstanding_debt)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          <footer className="sheet-foot">Напечатано {todayIso()} · {hotel.hotel_name}</footer>
        </div>
      )}
    </div>
  )
}
