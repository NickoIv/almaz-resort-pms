import { useEffect, useState } from 'react'
import { api } from '../api'
import { Spinner } from './ui'
import { addDaysIso, dateRange, daysBetween, money, pluralRu, timeRange, todayIso } from '../format'
import { STATUS_LABELS, UNIT_TYPE_LABELS, type Booking, type Unit } from '../types'

type TextSettings = { hotel_name: string; hotel_details: string }

/** How far ahead the sheet looks. A month is the horizon the board works in. */
const DAYS_AHEAD = 30

/**
 * One object, on paper: what is booked in it for the next month.
 *
 * This is the sheet someone carries away from the screen — to the reception
 * desk, to a phone call, to a handover between shifts. It is an internal
 * document, so it carries guest phone numbers and outstanding balances; the
 * thing a guest gets is the booking confirmation, which is a different sheet.
 *
 * A stay already in progress is included even though it started before today:
 * the API's window overlaps rather than contains, and "who is in this room right
 * now" is the first question anyone asks of it.
 */
export default function UnitSheet({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [hotel, setHotel] = useState<TextSettings>({
    hotel_name: 'Taura',
    hotel_details: 'ул. Алма-Арасан, 4а, Алматы',
  })
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  const from = todayIso()
  const to = addDaysIso(from, DAYS_AHEAD)

  useEffect(() => {
    Promise.all([
      api<{ text: TextSettings }>('/settings')
        .then((data) => setHotel(data.text))
        .catch(() => undefined),
      api<Booking[]>(`/bookings?unit_id=${unit.id}&from=${from}&to=${to}`)
        .then((rows) => setBookings(rows.filter((row) => row.status !== 'free')))
        .catch(() => setBookings([])),
    ]).finally(() => setLoading(false))
  }, [unit.id, from, to])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isRoom = unit.type === 'room'
  // Sold by night, so a booking's length is only meaningful for rooms — an
  // hourly gazebo would report every stay as nought nights.
  const nights = bookings.reduce(
    (sum, row) =>
      sum + (isRoom && row.date_from && row.date_to ? daysBetween(row.date_from, row.date_to) : 0),
    0
  )
  // Money is admin-only at the API, so its absence is what decides the columns
  // rather than a second copy of the role check.
  const withMoney = bookings.some((row) => row.total_amount !== undefined)

  return (
    <div className="sheet-overlay">
      <div className="sheet-toolbar no-print">
        <button className="btn btn-sm btn-primary" onClick={() => window.print()} disabled={loading}>
          Печать
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Закрыть
        </button>
        <span className="field-hint">Служебный лист — с телефонами гостей и остатками.</span>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="print-sheet">
          <header className="sheet-head">
            <h1>{hotel.hotel_name}</h1>
            {hotel.hotel_details && <div className="sheet-meta">{hotel.hotel_details}</div>}
            <div className="receipt-title">
              {isRoom ? `Номер ${unit.name}` : unit.name} — брони на {DAYS_AHEAD} дней
            </div>
          </header>

          <section className="receipt-grid">
            <div>
              <div className="receipt-label">Объект</div>
              <div className="receipt-value">{isRoom ? `Номер ${unit.name}` : unit.name}</div>
              <div className="receipt-sub">
                {UNIT_TYPE_LABELS[unit.type]} · {unit.category ?? 'без категории'} · до{' '}
                {unit.capacity} чел.
              </div>
            </div>
            <div>
              <div className="receipt-label">Сейчас</div>
              <div className="receipt-value">{STATUS_LABELS[unit.status]}</div>
              {unit.needs_cleaning && (
                <div className="receipt-sub">
                  требуется уборка · {unit.cleaning_pending} из {unit.cleaning_total} пунктов
                </div>
              )}
            </div>
            <div>
              <div className="receipt-label">Период</div>
              <div className="receipt-value">{dateRange(from, to)}</div>
              <div className="receipt-sub">
                {isRoom
                  ? `занято ${nights} ${pluralRu(nights, ['ночь', 'ночи', 'ночей'])} из ${DAYS_AHEAD}`
                  : `${bookings.length} ${pluralRu(bookings.length, ['бронь', 'брони', 'броней'])}`}
              </div>
            </div>
          </section>

          {bookings.length === 0 ? (
            <p>За этот период броней нет.</p>
          ) : (
            <table className="receipt-table">
              <thead>
                <tr>
                  <th>{isRoom ? 'Заезд — выезд' : 'Период'}</th>
                  <th>Гость</th>
                  <th>Статус</th>
                  {withMoney && <th className="num">Начислено</th>}
                  {withMoney && <th className="num">Остаток</th>}
                </tr>
              </thead>
              <tbody>
                {bookings.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {isRoom
                        ? dateRange(row.date_from, row.date_to)
                        : timeRange(row.date_from, row.date_to)}
                      <span className="receipt-sub">бронь №{row.id}</span>
                    </td>
                    <td>
                      {row.guest_name ?? '—'}
                      {row.guest_phone && <span className="receipt-sub">{row.guest_phone}</span>}
                    </td>
                    <td>
                      {row.status ? STATUS_LABELS[row.status] : '—'}
                      {/* An unchecked booking is worth flagging on the sheet
                          someone reads before the guest arrives — that is the
                          last moment a wrong date can still be caught. */}
                      {!row.verified_at && <span className="receipt-sub">не проверена</span>}
                    </td>
                    {withMoney && (
                      <td className="num">
                        {money((row.total_amount ?? 0) + (row.charges_amount ?? 0), row.currency)}
                      </td>
                    )}
                    {withMoney && (
                      <td className="num">
                        {(row.remaining_amount ?? 0) > 0
                          ? money(row.remaining_amount, row.currency)
                          : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <footer className="sheet-foot">Напечатано {todayIso()} · {hotel.hotel_name}</footer>
        </div>
      )}
    </div>
  )
}
