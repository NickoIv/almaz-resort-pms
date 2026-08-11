import type { ReactNode } from 'react'
import { useCountUp } from '../useCountUp'
import type { UnitStatus } from '../types'

/**
 * A whole number that rolls up to its value once, as the page arrives.
 * Reserved for the dashboard's headline figures — see useCountUp for why it
 * does not re-animate on every change.
 */
export function CountUp({ value }: { value: number }) {
  return <>{Math.round(useCountUp(value))}</>
}

export function StatusDot({ status }: { status: UnitStatus | 'cleaning' }) {
  return <span className={`dot dot-${status}`} />
}

/**
 * The four states a unit can be in, said in one consistent way everywhere.
 *
 * A chain PMS floods each row of its grid with a saturated fill — yellow for
 * held, green for arriving, orange for a problem — and a legend along the
 * bottom to decode it. It is scannable, and it is worse than this in two
 * respects, both of which this fixes rather than copies.
 *
 * **The shape carries the meaning as well as the colour.** Empty ring, part
 * ring, full disc: a progression anyone can read, including the eight percent
 * of men who cannot separate their green from their orange. Colour alone is a
 * badge that says nothing to those readers, however bright it is.
 *
 * **And the word is always there.** A legend somewhere else on the page is a
 * lookup; the word beside the mark is the answer. That costs a few pixels and
 * removes the need for the legend to exist at all.
 *
 * The tint and the ink come from the status tokens, which already carry a
 * readable pair for each state in both themes — `-ink` exists precisely for
 * text on a tinted chip.
 */
const STATUS_GLYPH: Record<UnitStatus | 'cleaning', string> = {
  free: '○',
  booked: '◔',
  occupied: '●',
  cleaning: '✦',
}

const STATUS_WORD: Record<UnitStatus | 'cleaning', string> = {
  free: 'Свободен',
  booked: 'Забронирован',
  occupied: 'Занят',
  cleaning: 'Уборка',
}

export function StatusBadge({
  status,
  label,
}: {
  status: UnitStatus | 'cleaning'
  /** Overrides the word — for «осталось 3 из 8» and the like. */
  label?: string
}) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-glyph" aria-hidden="true">
        {STATUS_GLYPH[status]}
      </span>
      {label ?? STATUS_WORD[status]}
    </span>
  )
}

export function Spinner() {
  return (
    <div className="splash">
      <div className="spinner" />
    </div>
  )
}

export function Alert({ children }: { children: ReactNode }) {
  return <div className="alert">{children}</div>
}

export function EmptyState({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="big">{icon}</div>
      {children}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal glass" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}