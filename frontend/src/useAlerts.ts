import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { playChime } from './sound'
import type { Role } from './types'

export type AlertKind = 'sla' | 'waitlist' | 'booking'

export type StaffAlert = {
  id: string
  kind: AlertKind
  title: string
  detail: string
  href: string
  at: string
}

type AlertsResponse = {
  sla_minutes: number
  booking_window_hours: number
  alerts: StaffAlert[]
}

/** Often enough to be useful on a shift, rare enough to be free. */
const POLL_MS = 45_000

const ACK_KEY = 'taura_pms_acked_alerts'

/** Waiters have no alerts of their own; polling would only earn them a 403. */
export function roleHasAlerts(role: Role): boolean {
  return role === 'admin' || role === 'housekeeper'
}

function readAcked(): string[] {
  try {
    const raw = localStorage.getItem(ACK_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeAcked(ids: string[]): void {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify(ids))
  } catch {
    // Private mode, quota — dismissal just will not survive a reload.
  }
}

/**
 * Outstanding alerts for the signed-in member of staff.
 *
 * Acknowledgement is kept in localStorage, so dismissing something does not
 * bring it back on the next reload. The stored set is pruned to what the
 * server still reports on every successful poll: it cannot grow without bound,
 * and if a situation genuinely recurs — the same guest waiting, a unit that
 * frees, fills and frees again — it is announced again, which is right.
 *
 * The chime plays once per poll in which something new turned up, not once per
 * alert. Ten overdue rooms at the start of a shift is one event to a person.
 */
export function useAlerts(role: Role) {
  const enabled = roleHasAlerts(role)

  const [alerts, setAlerts] = useState<StaffAlert[]>([])
  const [acked, setAcked] = useState<string[]>(readAcked)

  // Ids already announced this session. Kept in a ref because changing it must
  // never itself cause a render.
  const announced = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const data = await api<AlertsResponse>('/alerts')
      const live = data.alerts
      setAlerts(live)

      const liveIds = new Set(live.map((alert) => alert.id))
      setAcked((previous) => {
        const pruned = previous.filter((id) => liveIds.has(id))
        if (pruned.length !== previous.length) writeAcked(pruned)
        // Forget announcements for alerts that are gone, so the same id
        // returning later counts as new again.
        for (const id of announced.current) if (!liveIds.has(id)) announced.current.delete(id)

        const outstanding = live.filter((alert) => !pruned.includes(alert.id))
        const fresh = outstanding.filter((alert) => !announced.current.has(alert.id))
        if (fresh.length > 0) {
          for (const alert of fresh) announced.current.add(alert.id)
          playChime()
        }
        return pruned
      })
    } catch {
      // A failed poll leaves the previous list alone. An alert banner that
      // blinked out whenever the network hiccupped would be worse than stale.
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    // Coming back to the tab should show the current state, not wait out the
    // rest of the interval.
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, load])

  const visible = useMemo(
    () => alerts.filter((alert) => !acked.includes(alert.id)),
    [alerts, acked]
  )

  const acknowledge = useCallback((id: string) => {
    setAcked((previous) => {
      if (previous.includes(id)) return previous
      const next = [...previous, id]
      writeAcked(next)
      return next
    })
  }, [])

  const acknowledgeAll = useCallback(() => {
    setAcked((previous) => {
      const next = [...new Set([...previous, ...alerts.map((alert) => alert.id)])]
      writeAcked(next)
      return next
    })
  }, [alerts])

  return { alerts: visible, acknowledge, acknowledgeAll, refresh: load }
}