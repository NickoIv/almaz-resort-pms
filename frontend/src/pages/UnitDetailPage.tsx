import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import BookingModal from '../components/BookingModal'
import ChargeModal from '../components/ChargeModal'
import Checklist from '../components/Checklist'
import GuestHistoryModal from '../components/GuestHistoryModal'
import MonthCalendar from '../components/MonthCalendar'
import PaymentModal from '../components/PaymentModal'
import PhotoGallery from '../components/PhotoGallery'
import InvoiceSheet from '../components/InvoiceSheet'
import UnitSheet from '../components/UnitSheet'
import { Alert, EmptyState, Modal, Spinner, StatusBadge, StatusDot } from '../components/ui'
import { addDaysIso, almatyMonth, dateRange, money, shortDate, timeRange, todayIso } from '../format'
import { CANCEL_REASON_LABELS, type CancelReason } from '../cancellation'
import {
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  UNIT_TYPE_LABELS,
  type Booking,
  type Calendar,
  type CalendarDay,
  type Charge,
  type ChecklistItem,
  type GroupDetail,
  type Payment,
  type Unit,
} from '../types'

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

export default function UnitDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [unit, setUnit] = useState<Unit | null>(null)
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [charges, setCharges] = useState<Charge[]>([])
  const [group, setGroup] = useState<GroupDetail | null>(null)
  // The calendar opens on the hotel's current month, not the viewer's.
  const [month, setMonth] = useState(() => almatyMonth())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Two separate intents: `showBooking` takes a new reservation (which may be
  // for dates months away), `editBooking` opens the stay that is running now.
  const [showBooking, setShowBooking] = useState(false)
  const [editBooking, setEditBooking] = useState(false)
  /** The loose end from a past booking nobody closed — see UnclosedBooking. */
  const [fixUnclosed, setFixUnclosed] = useState(false)
  /**
   * What was pressed in the month grid.
   *
   * A day carrying a booking opens that booking — including a past one, which
   * is the whole reason this is worth having: the calendar shows a stay from
   * three weeks ago and until now there was no way to reach it. A free day
   * starts a new booking arriving that day, rather than on the first free date
   * after today, because the day someone pressed is the day they meant.
   */
  const [dayBooking, setDayBooking] = useState<Booking | null>(null)
  const [dayFrom, setDayFrom] = useState<string | null>(null)
  const [dayError, setDayError] = useState<string | null>(null)
  /**
   * A free night pressed right up against an existing stay.
   *
   * Booking it outright is what the calendar used to do, and it is how one
   * arrival turned into several bookings: a guest staying an extra night got a
   * second booking rather than a longer first one. Two bookings then have to be
   * closed twice, are charged twice, and read as two guests in every list —
   * which is exactly what the desk was complaining about.
   *
   * So the day asks first. «Продлить» is offered, never applied: it opens the
   * ordinary form on the existing booking with the dates already stretched, and
   * nothing is written until Сохранить.
   */
  const [extend, setExtend] = useState<{
    day: string
    booking: Booking
    side: 'after' | 'before'
  } | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [showCharge, setShowCharge] = useState(false)
  const [showGuest, setShowGuest] = useState(false)
  const [showInvoice, setShowInvoice] = useState(false)
  const [showUnitSheet, setShowUnitSheet] = useState(false)
  const [sendingToCleaning, setSendingToCleaning] = useState(false)

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
        const [paymentRows, chargeRows] = await Promise.all([
          api<Payment[]>(`/bookings/${bookingId}/payments`).catch(() => []),
          api<Charge[]>(`/bookings/${bookingId}/charges`).catch(() => []),
        ])
        setPayments(paymentRows)
        setCharges(chargeRows)

        const groupId = unitData.current_booking?.group_id
        setGroup(
          groupId ? await api<GroupDetail>(`/bookings/group/${groupId}`).catch(() => null) : null
        )
      } else {
        setPayments([])
        setCharges([])
        setGroup(null)
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
    api<Calendar>(`/units/${id}/calendar?month=${month}`)
      .then(setCalendar)
      .catch(() => setCalendar(null))
  }, [id, month])

  async function refreshAll() {
    await load()
    if (id) {
      setCalendar(await api<Calendar>(`/units/${id}/calendar?month=${month}`).catch(() => null))
    }
  }

  async function removeCharge(chargeId: number) {
    await api(`/bookings/${unit?.current_booking?.id}/charges/${chargeId}`, { method: 'DELETE' })
    await refreshAll()
  }

  if (loading) return <Spinner />
  if (error) return <Alert>{error}</Alert>
  if (!unit) return <EmptyState icon="🔍">Объект не найден</EmptyState>

  /**
   * Start a fresh checklist for this unit, whatever its booking says.
   *
   * Until now a checklist only ever appeared on checkout, so a room that got
   * dirty mid-stay, or one whose list someone ticked off too early, could not
   * be put back in the queue at all. The endpoint for it already existed and
   * nothing called it.
   */
  async function sendToCleaning() {
    if (!unit) return
    // Resetting under a guest who is still in the room is a legitimate thing
    // to want and an easy thing to do by accident, so it is confirmed.
    if (
      active &&
      !window.confirm(
        `В «${unit.name}» сейчас проживает гость. Всё равно отправить на уборку — ` +
          'чек-лист начнётся заново?'
      )
    ) {
      return
    }

    setSendingToCleaning(true)
    setError(null)
    try {
      const fresh = await api<ChecklistItem[]>(`/cleaning/unit/${unit.id}/reset`, {
        method: 'POST',
      })
      setChecklist(fresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить на уборку')
    } finally {
      setSendingToCleaning(false)
    }
  }

  // Rooms are sold by night and have a housekeeping checklist; recreation
  // units are sold by the hour and have neither.
  const isRoom = unit.type === 'room'
  const booking = unit.current_booking ?? unit.next_booking
  const active = unit.current_booking

  /**
   * Where a new reservation should start.
   *
   * The morning the current guest leaves, not today: today is taken, and
   * offering it as the default made the form open on dates the server was
   * always going to refuse. Falls back to today when the unit is empty.
   */
  const nextFreeDay =
    active?.date_to && isRoom ? active.date_to.slice(0, 10) : todayIso()
  const rate = active?.total_amount ?? 0
  const chargesTotal = active?.charges_amount ?? 0
  const prepaid = active?.prepaid_amount ?? 0
  const deposit = active?.deposit_amount ?? 0
  const remaining = active?.remaining_amount ?? 0
  const billed = rate + chargesTotal
  const paidShare = billed > 0 ? Math.min(100, (prepaid / billed) * 100) : 0
  const doneCount = checklist.filter((item) => item.is_done).length


  /**
   * The stay touching a free day, if there is one: the night before it ends, or
   * the night after it begins. Rooms only — a gazebo is booked by the hour, and
   * yesterday's sitting has nothing to do with today's.
   */
  async function neighbourStay(
    day: CalendarDay
  ): Promise<{ booking: Booking; side: 'after' | 'before' } | null> {
    if (!isRoom || !calendar) return null
    const index = calendar.days.findIndex((item) => item.date === day.date)
    if (index < 0) return null

    const previous = calendar.days[index - 1]
    const next = calendar.days[index + 1]
    // The stay that ends on this day comes first: staying on is far commoner
    // than arriving a day early, and only one choice is worth offering.
    const touching = previous?.booking_id
      ? { date: previous.date, id: previous.booking_id, side: 'after' as const }
      : next?.booking_id
        ? { date: next.date, id: next.booking_id, side: 'before' as const }
        : null
    if (!touching) return null

    const rows = await api<Booking[]>(
      `/bookings?unit_id=${unit!.id}&from=${touching.date}&to=${touching.date}`
    )
    const found = rows.find((row) => row.id === touching.id)
    // A cancelled stay is not something to extend.
    if (!found || (found.status !== 'booked' && found.status !== 'occupied')) return null
    return { booking: found, side: touching.side }
  }

  /** Opening whatever is on a day of the month grid. */
  async function openDay(day: CalendarDay) {
    setDayError(null)
    if (!day.booking_id) {
      try {
        const touching = await neighbourStay(day)
        if (touching) {
          setExtend({ day: day.date, ...touching })
          return
        }
      } catch {
        // Only an offer was lost; booking the night still works.
      }
      setDayFrom(day.date)
      setShowBooking(true)
      return
    }
    try {
      // Asked for by date rather than by id: there is no per-booking endpoint,
      // and the unit plus the day is enough to find the one that was pressed.
      const onThatDay = await api<Booking[]>(
        `/bookings?unit_id=${unit!.id}&from=${day.date}&to=${day.date}`
      )
      const found = onThatDay.find((item) => item.id === day.booking_id) ?? onThatDay[0]
      if (!found) {
        setDayError('Бронь не найдена — возможно, её уже закрыли.')
        return
      }
      setDayBooking(found)
    } catch (err) {
      setDayError(err instanceof Error ? err.message : 'Не удалось открыть бронь')
    }
  }

  return (
    <>
      <Link className="back-link" to={isRoom ? '/rooms' : '/restaurant'}>
        ← {isRoom ? 'Все номера' : 'Зона отдыха'}
      </Link>

      <div className="page-head">
        <div>
          <h1>{isRoom ? `Номер ${unit.name}` : unit.name}</h1>
          <div className="page-sub">
            {UNIT_TYPE_LABELS[unit.type]} · {unit.category ?? '—'} · до {unit.capacity} чел. ·{' '}
            <StatusBadge status={unit.status} />
          </div>
        </div>
        <div className="page-head-actions">
          {/* Always available, unlike the receipt: "what is booked in here" is
              a question worth printing precisely when the object is empty
              today. */}
          <button className="btn btn-sm" onClick={() => setShowUnitSheet(true)}>
            Печать по объекту
          </button>
          {isAdmin && active && (
            <>
              <button className="btn btn-sm" onClick={() => setShowInvoice(true)}>
                Печать инвойса
              </button>
              <button className="btn btn-sm" onClick={() => setShowCharge(true)}>
                Начислить
              </button>
              <button className="btn btn-sm" onClick={() => setShowPayment(true)}>
                Внести оплату
              </button>
              <button className="btn btn-sm" onClick={() => setEditBooking(true)}>
                Изменить бронь
              </button>
            </>
          )}
          {/*
            Booking ahead is not editing what is here now.

            These used to be one button that said «Изменить бронь» whenever the
            unit was occupied, which left no way at all to take a reservation for
            next week on a room with a guest in it today — the single case a
            hotel needs most. They are two controls because they are two
            different acts on two different bookings.
          */}
          {isAdmin && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowBooking(true)}>
              Новая бронь
            </button>
          )}
        </div>
      </div>

      {/* A booking that fell off the end of time. The unit is free and the page
          rightly says so — but somebody has to say what happened to this stay,
          and until now there was nowhere in the app it appeared at all. The
          «Гость не заехал» alert points here, so here is where the answer has
          to be. */}
      {unit.unclosed_booking && isAdmin && (
        <div className="notice notice-warn">
          <strong>
            {unit.unclosed_booking.status === 'booked'
              ? 'Гость не заехал'
              : 'Гость не был выселен'}
          </strong>{' '}
          — бронь {dateRange(unit.unclosed_booking.date_from, unit.unclosed_booking.date_to)},{' '}
          {unit.unclosed_booking.guest_name ?? 'без имени'}
          {unit.unclosed_booking.guest_phone && ` · ${unit.unclosed_booking.guest_phone}`}. Даты
          прошли, а бронь так и осталась открытой — она числится за объектом и попадает в
          «Начислено по броням».
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-primary" onClick={() => setFixUnclosed(true)}>
              Открыть бронь
            </button>
          </div>
        </div>
      )}

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
            {calendar ? (
              <MonthCalendar days={calendar.days} onSelect={openDay} />
            ) : (
              <Spinner />
            )}
            {dayError && <div className="field-hint">{dayError}</div>}
          </section>

          <PhotoGallery unitId={unit.id} bookingId={active?.id ?? null} />

          {/* Both rooms and recreation units have checklists — different
              templates, same queue — so the panel is no longer room-only. */}
          <section className="panel glass">
            <div className="panel-title">
              <StatusDot status="cleaning" /> Чек-лист уборки
              <span className="count">
                {checklist.length > 0 ? `${doneCount} / ${checklist.length}` : 'не начат'}
              </span>
            </div>

            {checklist.length === 0 ? (
              <div className="dash-empty">
                Чек-листа нет — объект считается чистым.
              </div>
            ) : (
              <Checklist
                items={checklist}
                onChanged={(updated) =>
                  setChecklist((prev) =>
                    prev.map((item) => (item.id === updated.id ? updated : item))
                  )
                }
              />
            )}

            {isAdmin && (
              <button
                className="btn btn-sm"
                style={{ marginTop: 16 }}
                onClick={sendToCleaning}
                disabled={sendingToCleaning}
              >
                {sendingToCleaning ? 'Отправляем…' : 'Отправить на уборку'}
              </button>
            )}
          </section>
        </div>

        <div>
          <section className="panel glass">
            <div className="panel-title">
              Гость
              {isAdmin && booking?.guest_phone && (
                <button className="btn btn-sm btn-ghost card-action" onClick={() => setShowGuest(true)}>
                  История гостя →
                </button>
              )}
            </div>
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
                  <span>{isRoom ? 'Заезд' : 'Начало'}</span>
                  <span>{booking.date_from?.slice(0, isRoom ? 10 : 16) ?? '—'}</span>
                </div>
                <div className="info-row">
                  <span>{isRoom ? 'Выезд' : 'Окончание'}</span>
                  <span>{booking.date_to?.slice(0, isRoom ? 10 : 16) ?? '—'}</span>
                </div>
                <div className="info-row">
                  <span>Период</span>
                  <span>
                    {isRoom
                      ? dateRange(booking.date_from, booking.date_to)
                      : timeRange(booking.date_from, booking.date_to)}
                  </span>
                </div>
                <div className="info-row">
                  <span>Статус</span>
                  <span>{STATUS_LABELS[booking.status ?? 'booked']}</span>
                </div>
                {booking.cancel_reason && (
                  <div className="info-row">
                    <span>Причина завершения</span>
                    <span>
                      {CANCEL_REASON_LABELS[booking.cancel_reason as CancelReason] ??
                        booking.cancel_reason}
                      {booking.cancel_note && (
                        <span className="cancel-note">{booking.cancel_note}</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="unit-empty">Активной брони нет</div>
            )}
          </section>

          {isAdmin && group && (
            <section className="panel glass">
              <div className="panel-title">
                Групповая бронь
                <span className="count">{group.bookings.length} объектов</span>
              </div>
              <div className="info-rows">
                <div className="info-row">
                  <span>Мероприятие</span>
                  <span>{group.group.name}</span>
                </div>
                <div className="info-row">
                  <span>Организатор</span>
                  <span>{group.group.guest_name}</span>
                </div>
              </div>
              <div className="group-units">
                {group.bookings.map((row) => (
                  <span
                    key={row.id}
                    className={`pill ${row.unit_name === unit.name ? 'pill-current' : ''}`}
                  >
                    {row.unit_name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {isAdmin && (
            <section className="panel glass">
              <div className="panel-title">Оплата</div>
              {active ? (
                <>
                  <div className="pay-rows">
                    <div className="pay-row">
                      <span>Проживание</span>
                      <span>{money(rate, active.currency)}</span>
                    </div>

                    {charges.map((charge) => (
                      <div className="pay-row charge-row" key={charge.id}>
                        <span title={charge.created_by_name ?? undefined}>+ {charge.reason}</span>
                        <span>{money(charge.amount, active.currency)}</span>
                        <button
                          className="charge-remove"
                          onClick={() => removeCharge(charge.id)}
                          aria-label="Убрать начисление"
                          title="Убрать начисление"
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    {chargesTotal !== 0 && (
                      <div className="pay-row subtotal">
                        <span>К оплате</span>
                        <span>{money(billed, active.currency)}</span>
                      </div>
                    )}

                    <div className="pay-row">
                      <span>Оплачено</span>
                      <span>{money(prepaid, active.currency)}</span>
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

                  {/* A deposit is a refundable hold, not money owed — it is shown
                      in its own block so it can never be read as part of the debt. */}
                  <div className="deposit-box">
                    <div>
                      <div className="deposit-label">Депозит / залог</div>
                      <div className="deposit-hint">возвратный, не входит в остаток</div>
                    </div>
                    <div className="deposit-value">{money(deposit, active.currency)}</div>
                  </div>

                  {payments.length > 0 && (
                    <>
                      <div className="panel-title" style={{ marginTop: 20 }}>
                        История платежей
                      </div>
                      <div className="info-rows">
                        {payments.map((payment) => (
                          <div className="info-row" key={payment.id}>
                            <span>
                              {payment.paid_at.slice(0, 16).replace('T', ' ')}
                              {payment.group_id && <span className="tag">групповой</span>}
                              {/* The name is the point of this list. Payments
                                  recorded before it was captured have none, and
                                  say so rather than being attributed to whoever
                                  looks most likely. */}
                              {payment.received_by_name ? (
                                <span className="field-hint"> принял: {payment.received_by_name}</span>
                              ) : (
                                payment.method !== 'adjustment' && (
                                  <span className="field-hint"> принявший не записан</span>
                                )
                              )}
                            </span>
                            <span>
                              {money(payment.amount, active.currency)} ·{' '}
                              {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
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

      {/* The night touches a stay: ask before making a second booking of it. */}
      {extend && (
        <Modal
          title={extend.side === 'after' ? 'Гость остаётся ещё на ночь?' : 'Гость заедет раньше?'}
          onClose={() => setExtend(null)}
        >
          <p>
            {shortDate(extend.day)} свободно, а рядом стоит бронь:{' '}
            <strong>{extend.booking.guest_name}</strong>,{' '}
            {dateRange(extend.booking.date_from, extend.booking.date_to)}.
          </p>
          <p className="field-hint">
            Продлить — это та же бронь на ночь длиннее: один счёт, один заезд, закрывать
            один раз. Отдельная бронь нужна, если это другой гость. Сумму после продления
            проверьте — она не пересчитывается сама.
          </p>
          <div className="modal-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setDayBooking(
                  extend.side === 'after'
                    ? { ...extend.booking, date_to: addDaysIso(extend.day, 1) }
                    : { ...extend.booking, date_from: extend.day }
                )
                setExtend(null)
              }}
            >
              {extend.side === 'after'
                ? `Продлить до ${shortDate(addDaysIso(extend.day, 1))}`
                : `Заезд с ${shortDate(extend.day)}`}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDayFrom(extend.day)
                setShowBooking(true)
                setExtend(null)
              }}
            >
              Отдельная бронь
            </button>
          </div>
        </Modal>
      )}

      {/* A new reservation, even when someone is in the unit today: `booking` is
          null on purpose, and the dates default to the first night after the
          current stay ends rather than to today, which is taken. */}
      {showBooking && (
        <BookingModal
          unitId={unit.id}
          unitType={unit.type}
          unitName={unit.name}
          booking={null}
          canSetPrice={isAdmin}
          hourly={!isRoom}
          initialFrom={dayFrom ?? nextFreeDay}
          initialTo={isRoom ? addDaysIso(dayFrom ?? nextFreeDay, 1) : undefined}
          onClose={() => {
            setShowBooking(false)
            setDayFrom(null)
          }}
          onSaved={refreshAll}
        />
      )}
      {editBooking && active && (
        <BookingModal
          unitId={unit.id}
          unitType={unit.type}
          unitName={unit.name}
          booking={active}
          canSetPrice={isAdmin}
          hourly={!isRoom}
          onClose={() => setEditBooking(false)}
          onSaved={refreshAll}
        />
      )}
      {/* The same form as everywhere else, so closing this is the ordinary
          «Выехал / отменена» with a reason — nothing special had to be invented
          for it, it just had to be reachable. */}
      {fixUnclosed && unit.unclosed_booking && (
        <BookingModal
          unitId={unit.id}
          unitType={unit.type}
          unitName={unit.name}
          booking={unit.unclosed_booking}
          canSetPrice={isAdmin}
          hourly={!isRoom}
          onClose={() => setFixUnclosed(false)}
          onSaved={refreshAll}
        />
      )}
      {dayBooking && (
        <BookingModal
          unitId={unit.id}
          unitType={unit.type}
          unitName={unit.name}
          booking={dayBooking}
          canSetPrice={isAdmin}
          hourly={!isRoom}
          onClose={() => setDayBooking(null)}
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
      {showCharge && active && (
        <ChargeModal
          bookingId={active.id}
          onClose={() => setShowCharge(false)}
          onSaved={refreshAll}
        />
      )}
      {showGuest && booking?.guest_phone && (
        <GuestHistoryModal phone={booking.guest_phone} onClose={() => setShowGuest(false)} />
      )}
      {showInvoice && active && (
        <InvoiceSheet
          unit={unit}
          booking={active}
          charges={charges}
          payments={payments}
          onClose={() => setShowInvoice(false)}
        />
      )}
      {showUnitSheet && <UnitSheet unit={unit} onClose={() => setShowUnitSheet(false)} />}
    </>
  )
}