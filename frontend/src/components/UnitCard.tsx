import { StatusDot } from './ui'
import { dateRange, money, timeRange } from '../format'
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

  return (
    <div className="unit-card glass" data-status={unit.status}>
      <button type="button" className="unit-card-hit" onClick={() => onOpen(unit)}>
        <div className="unit-card-top">
          <div>
            <div className="unit-name">{unit.name}</div>
            <div className="unit-meta">
              {unit.category ?? '—'} · до {unit.capacity} чел.
            </div>
          </div>
          <span className="unit-status">
            <StatusDot status={unit.status} />
            {STATUS_LABELS[unit.status]}
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
          <span className="pill pill-cleaning">
            <StatusDot status="cleaning" />
            уборка · {unit.cleaning_pending}
          </span>
        )}

        {action}
      </div>
    </div>
  )
}