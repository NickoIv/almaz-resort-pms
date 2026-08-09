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