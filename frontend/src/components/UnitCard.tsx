import { useState } from 'react'
import { StatusBadge } from './ui'
import { blockReasonWord } from '../blocks'
import { dateRange, money, shortDate, timeRange } from '../format'
import { STATUS_LABELS, type Unit } from '../types'

/**
 * One glass card in the dashboard grid: status, guest, dates, payment state
 * and a cleaning flag. Rooms show a date range; recreation units are sold by
 * the hour and show a clock range instead.
 */
export default function UnitCard({
  unit,
  onOpen,
  action,
}: {
  unit: Unit
  onOpen: (unit: Unit) => void
  /** Optional extra control, e.g. the waiter's quick-book button. */
  action?: React.ReactNode
}) {
  const booking = unit.current_booking ?? unit.next_booking
  const isUpcoming = !unit.current_booking && !!unit.next_booking
  const hourly = unit.type !== 'room'
  const active = unit.current_booking
  const showsAmounts = active?.total_amount !== undefined
  const due = (active?.remaining_amount ?? 0) > 0

  /**
   * The details panel: open while the pointer is over the card, or once the
   * "i" has been pressed. Two states rather than one, because a single flag
   * made the two ways in fight — hovering set it, and the click that followed
   * on the same gesture toggled it straight back off, so pressing "i" on a
   * desktop closed the panel that hovering had just opened.
   *
   * Pressing is what a phone has: there is no hover there, and pressing the
   * card itself navigates away from the grid being scanned.
   *
   * Leaving the card clears both, so a pinned panel does not follow the reader
   * down a grid of fourteen cards.
   */
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = Boolean(booking) && (hovered || pinned)

  return (
    <div
      className={`unit-card glass ${open ? 'is-peeking' : ''} ${
        unit.renovation ? 'is-renovating' : ''
      }`}
      data-status={unit.renovation ? 'renovation' : unit.status}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setPinned(false)
      }}
    >
      <button type="button" className="unit-card-hit" onClick={() => onOpen(unit)}>
        <div className="unit-card-top">
          <div>
            <div className="unit-name">{unit.name}</div>
            <div className="unit-meta">
              {unit.category ?? '—'} · до {unit.capacity} чел.
            </div>
          </div>
          <span className="unit-status">
            {/* Реставрация вытесняет статус, а не встаёт рядом: «свободен»
                на объекте, которого нет, — приглашение его продать. */}
            <StatusBadge status={unit.renovation ? 'renovation' : unit.status} />
          </span>
        </div>

        {booking ? (
          <div className="unit-guest">
            <div className="unit-guest-name">{booking.guest_name}</div>
            <div className="unit-dates">
              {isUpcoming && 'скоро · '}
              {hourly
                ? timeRange(booking.date_from, booking.date_to)
                : dateRange(booking.date_from, booking.date_to)}
            </div>
          </div>
        ) : unit.renovation ? (
          // Там же, где стоял бы гость: карточку читают, чтобы ответить «это
          // можно продать?», и «Нет брони» здесь сказало бы правду и обмануло.
          // Само слово «На реставрации» уже стоит на плашке выше — тут только
          // то, чего плашка не знает: почему и с каких пор.
          <div className="unit-guest">
            <div className="unit-guest-name">
              {unit.renovation.note ?? 'Открытие не назначено'}
            </div>
            <div className="unit-dates">с {shortDate(unit.renovation.since)}</div>
          </div>
        ) : unit.block ? (
          // Off sale reads where the guest would be, because it answers the
          // same question the card is scanned for: can I sell this tonight?
          // «Нет брони» there would say the opposite of the truth.
          <div className="unit-guest">
            <div className="unit-guest-name">Снят с продажи</div>
            <div className="unit-dates">
              {blockReasonWord(unit.block.reason)} · до{' '}
              {dateRange(unit.block.date_from, unit.block.date_to).split(' — ')[1] ??
                unit.block.date_to.slice(0, 10)}
            </div>
          </div>
        ) : (
          <div className="unit-empty">Нет брони</div>
        )}
      </button>

      <div className="unit-foot">
        {showsAmounts ? (
          <span className={`money ${due ? 'money-due' : ''}`}>
            {due ? (
              <>
                долг <strong>{money(active?.remaining_amount, active?.currency)}</strong>
              </>
            ) : (
              <>оплачено полностью</>
            )}
          </span>
        ) : (
          // Waiters see the flag but never the amounts.
          active && (
            <span className={`pill ${active.is_paid ? 'pill-paid' : 'pill-due'}`}>
              {active.is_paid ? 'оплачено' : 'не оплачено'}
            </span>
          )
        )}

        {unit.needs_cleaning && (
          <StatusBadge status="cleaning" label={`уборка · ${unit.cleaning_pending}`} />
        )}

        {booking && (
          <button
            type="button"
            className="unit-peek-toggle"
            aria-expanded={open}
            aria-label={open ? 'Скрыть детали брони' : 'Показать детали брони'}
            onClick={() => setPinned((was) => !was)}
          >
            i
          </button>
        )}

        {action}
      </div>

      {/* What a sunbed or a gazebo is actually booked for. It was on no screen
          short of opening the unit: the card showed a name and a clock range,
          and answering "whose is it, and have they paid" meant leaving the grid
          you were reading. */}
      {open && booking && (
        <div className="unit-peek" role="group" aria-label="Детали брони">
          <div className="info-rows">
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
                {hourly
                  ? timeRange(booking.date_from, booking.date_to)
                  : dateRange(booking.date_from, booking.date_to)}
              </span>
            </div>
            <div className="info-row">
              <span>Статус</span>
              <span>
                {isUpcoming ? 'ещё не заехал' : STATUS_LABELS[unit.status]}
                {!booking.verified_at && ' · не проверена'}
              </span>
            </div>
            {/* Amounts only where the API sent them — a waiter sees the paid
                flag on the card and nothing more, and this must not become a
                way around that. */}
            {booking.total_amount !== undefined && (
              <>
                <div className="info-row">
                  <span>Начислено</span>
                  <span>
                    {money(
                      (booking.total_amount ?? 0) + (booking.charges_amount ?? 0),
                      booking.currency
                    )}
                  </span>
                </div>
                <div className="info-row">
                  <span>Остаток</span>
                  <span className={(booking.remaining_amount ?? 0) > 0 ? 'money-due' : undefined}>
                    {money(booking.remaining_amount, booking.currency)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}