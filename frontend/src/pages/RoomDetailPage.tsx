import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import BookingModal from '../components/BookingModal'
import Checklist from '../components/Checklist'
import MonthCalendar from '../components/MonthCalendar'
import PaymentModal from '../components/PaymentModal'
import { Alert, EmptyState, Spinner, StatusDot } from '../components/ui'
import { dateRange, money } from '../format'
import { STATUS_LABELS, type Calendar, type ChecklistItem, type Payment, type Unit } from '../types'

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

function monthLabel(month: string): string {
  const [year, monthIndex] = month.split('-')
  return `${MONTH_NAMES[Number(monthIndex) - 1]} ${year}`
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [unit, setUnit] = useState<Unit | null>(null)
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showBooking, setShowBooking] = useState(false)
  const [showPayment, setShowPayment] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const [unitData, checklistData] = await Promise.all([
        api<Unit>(`/units/${id}`),
        api<ChecklistItem[]>(`/cleaning/unit/${id}`).catch(() => []),
      ])
      setUnit(unitData)
      setChecklist(checklistData)

      const bookingId = unitData.current_booking?.id
      if (isAdmin && bookingId) {
        setPayments(await api<Payment[]>(`/bookings/${bookingId}/payments`).catch(() => []))
      } else {
        setPayments([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [id, isAdmin])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!id) return
    api<Calendar>(`/units/${id}/calendar?month=${month}`).then(setCalendar).catch(() => setCalendar(null))
  }, [id, month])

  async function refreshAll() {
    await load()
    if (id) {
      setCalendar(await api<Calendar>(`/units/${id}/calendar?month=${month}`).catch(() => null))
    }
  }

  if (loading) return <Spinner />
  if (error) return <Alert>{error}</Alert>
  if (!unit) return <EmptyState icon="🔍">Номер не найден</EmptyState>

  const booking = unit.current_booking ?? unit.next_booking
  const active = unit.current_booking
  const total = active?.total_amount ?? 0
  const prepaid = active?.prepaid_amount ?? 0
  const remaining = active?.remaining_amount ?? 0
  const paidShare = total > 0 ? Math.min(100, (prepaid / total) * 100) : 0
  const doneCount = checklist.filter((item) => item.is_done).length

  return (
    <>
      <Link className="back-link" to="/rooms">
        ← Все номера
      </Link>

      <div className="page-head">
        <div>
          <h1>Номер {unit.name}</h1>
          <div className="page-sub">
            {unit.category ?? '—'} · до {unit.capacity} чел. ·{' '}
            <StatusDot status={unit.status} /> {STATUS_LABELS[unit.status]}
          </div>
        </div>
        <div className="page-head-actions">
          {isAdmin && active && (
            <button className="btn btn-sm" onClick={() => setShowPayment(true)}>
              Внести оплату
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowBooking(true)}>
              {active ? 'Изменить бронь' : 'Новая бронь'}
            </button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <section className="panel glass">
            <div className="cal-head">
              <button className="btn btn-sm btn-ghost" onClick={() => setMonth(shiftMonth(month, -1))}>
                ←
              </button>
              <div className="cal-month">{monthLabel(month)}</div>
              <button className="btn btn-sm btn-ghost" onClick={() => setMonth(shiftMonth(month, 1))}>
                →
              </button>
              <div className="legend" style={{ margin: 0, marginLeft: 'auto' }}>
                <span>
                  <StatusDot status="booked" /> бронь
                </span>
                <span>
                  <StatusDot status="occupied" /> занят
                </span>
              </div>
            </div>
            {calendar ? <MonthCalendar days={calendar.days} /> : <Spinner />}
          </section>

          <section className="panel glass">
            <div className="panel-title">
              <StatusDot status="cleaning" /> Чек-лист уборки
              <span className="count">
                {doneCount} / {checklist.length}
              </span>
            </div>
            <Checklist
              items={checklist}
              onChanged={(updated) =>
                setChecklist((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
              }
            />
          </section>
        </div>

        <div>
          <section className="panel glass">
            <div className="panel-title">Гость</div>
            {booking ? (
              <div className="info-rows">
                <div className="info-row">
                  <span>Имя</span>
                  <span>{booking.guest_name}</span>
                </div>
                <div className="info-row">
                  <span>Телефон</span>
                  <span>{booking.guest_phone ?? '—'}</span>
                </div>
                <div className="info-row">
                  <span>Даты</span>
                  <span>{dateRange(booking.date_from, booking.date_to)}</span>
                </div>
                <div className="info-row">
                  <span>Статус</span>
                  <span>{STATUS_LABELS[booking.status ?? 'booked']}</span>
                </div>
              </div>
            ) : (
              <div className="unit-empty">Активной брони нет</div>
            )}
          </section>

          {isAdmin && (
            <section className="panel glass">
              <div className="panel-title">Оплата</div>
              {active ? (
                <>
                  <div className="pay-rows">
                    <div className="pay-row">
                      <span>Стоимость</span>
                      <span>{money(total, active.currency)}</span>
                    </div>
                    <div className="pay-row">
                      <span>Оплачено</span>
                      <span>{money(prepaid, active.currency)}</span>
                    </div>
                    <div className="pay-row">
                      <span>Депозит</span>
                      <span>{money(active.deposit_amount, active.currency)}</span>
                    </div>
                    <div className="pay-row total">
                      <span>Остаток</span>
                      <span className={remaining > 0 ? 'money-due' : ''}>
                        {money(remaining, active.currency)}
                      </span>
                    </div>
                  </div>
                  <div className="pay-bar">
                    <div className="pay-bar-fill" style={{ width: `${paidShare}%` }} />
                  </div>

                  {payments.length > 0 && (
                    <>
                      <div className="panel-title" style={{ marginTop: 20 }}>
                        История платежей
                      </div>
                      <div className="info-rows">
                        {payments.map((payment) => (
                          <div className="info-row" key={payment.id}>
                            <span>{payment.paid_at.slice(0, 16).replace('T', ' ')}</span>
                            <span>
                              {money(payment.amount, active.currency)} · {payment.method}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="unit-empty">Нет активной брони</div>
              )}
            </section>
          )}
        </div>
      </div>

      {showBooking && (
        <BookingModal
          unitId={unit.id}
          booking={active ?? null}
          canSetPrice={isAdmin}
          onClose={() => setShowBooking(false)}
          onSaved={refreshAll}
        />
      )}
      {showPayment && active && (
        <PaymentModal
          bookingId={active.id}
          onClose={() => setShowPayment(false)}
          onSaved={refreshAll}
        />
      )}
    </>
  )
}