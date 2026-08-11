import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTitleFlash } from '../useTitleFlash'
import type { AlertKind, StaffAlert } from '../useAlerts'

const KIND_ICON: Record<AlertKind, string> = {
  sla: '🧹',
  waitlist: '📝',
  booking: '🗓',
  upcoming: '⏰',
  noshow: '🚪',
}

const KIND_LABEL: Record<AlertKind, string> = {
  sla: 'Уборка',
  waitlist: 'Лист ожидания',
  booking: 'Бронь',
  upcoming: 'Скоро гости',
  noshow: 'Не заехал',
}

/**
 * The bell in the header: a count, a pulse, and a list that stays until each
 * line is dismissed by hand.
 *
 * Nothing here times out. These are events someone has to act on — a room past
 * its cleaning deadline, a guest who can finally be placed — and a toast that
 * fades after five seconds is exactly how such a thing gets missed.
 */
export default function AlertCenter({
  alerts,
  onAcknowledge,
  onAcknowledgeAll,
}: {
  alerts: StaffAlert[]
  onAcknowledge: (id: string) => void
  onAcknowledgeAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const count = alerts.length

  // Flash the tab title while something is outstanding and the tab is in the
  // background. The hook decides on the focus part.
  useTitleFlash(count > 0)

  // Close the panel on an outside click or Escape, like the modals do.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Nothing outstanding: the bell disappears rather than sitting there greyed
  // out, so its presence alone means "there is something".
  useEffect(() => {
    if (count === 0) setOpen(false)
  }, [count])

  if (count === 0) return null

  return (
    <div className="alert-center" ref={root}>
      <button
        type="button"
        className="alert-bell"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-label={`Событий, требующих внимания: ${count}`}
      >
        <span className="alert-bell-icon" aria-hidden="true">
          🔔
        </span>
        <span className="alert-bell-count">{count}</span>
      </button>

      {open && (
        <div className="alert-panel glass" role="dialog" aria-label="Требуют внимания">
          <div className="alert-panel-head">
            <span>Требуют внимания</span>
            <button className="btn btn-sm btn-ghost" onClick={onAcknowledgeAll}>
              Отметить все
            </button>
          </div>

          <ul className="alert-list">
            {alerts.map((alert) => (
              <li className="alert-item" key={alert.id} data-kind={alert.kind}>
                <span className="alert-icon" aria-hidden="true">
                  {KIND_ICON[alert.kind]}
                </span>
                <div className="alert-body">
                  <Link className="alert-title" to={alert.href} onClick={() => setOpen(false)}>
                    {alert.title}
                  </Link>
                  <div className="alert-detail">
                    <span className="alert-kind">{KIND_LABEL[alert.kind]}</span>
                    {alert.detail}
                  </div>
                </div>
                <button
                  className="alert-dismiss"
                  onClick={() => onAcknowledge(alert.id)}
                  aria-label={`Отметить как прочитанное: ${alert.title}`}
                  title="Отметить как прочитанное"
                >
                  ✓
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}