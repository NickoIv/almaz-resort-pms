import { StatusDot } from './ui'
import { dateRange, money } from '../format'
import { STATUS_LABELS, type Unit } from '../types'

/**
 * One glass card in the dashboard grid: status, guest, dates,
 * payment state and a cleaning flag.
 */
export default function UnitCard({ unit, onOpen }: { unit: Unit; onOpen: (unit: Unit) => void }) {
  const booking = unit.current_booking ?? unit.next_booking
  const isUpcoming = !unit.current_booking && !!unit.next_booking
  const showsMoney = unit.current_booking?.total_amount !== undefined
  const due = (unit.current_booking?.remaining_amount ?? 0) > 0

  return (
    <button
      type="button"
      className="unit-card glass"
      data-status={unit.status}
      onClick={() => onOpen(unit)}
    >
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
            {dateRange(booking.date_from, booking.date_to)}
          </div>
        </div>
      ) : (
        <div className="unit-empty">Нет брони</div>
      )}

      <div className="unit-foot">
        {showsMoney && (
          <span className={`money ${due ? 'money-due' : ''}`}>
            {due ? (
              <>
                долг <strong>{money(unit.current_booking?.remaining_amount, unit.current_booking?.currency)}</strong>
              </>
            ) : (
              <>оплачено полностью</>
            )}
          </span>
        )}
        {unit.needs_cleaning && (
          <span className="pill pill-cleaning">
            <StatusDot status="cleaning" />
            уборка · {unit.cleaning_pending}
          </span>
        )}
      </div>
    </button>
  )
}