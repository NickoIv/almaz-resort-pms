import { useEffect, useRef } from 'react'
import { onDataChanged } from './api'

/**
 * How often a shared screen re-asks on its own.
 *
 * Only for the pages several people watch at once — the board, the summary,
 * the cleaning queue, the recreation grid. A minute is slower than the bell's
 * 45 seconds on purpose: the bell is the thing that shouts, and a page that
 * quietly agrees with it a moment later is fine.
 */
const SHARED_POLL_MS = 60_000

/**
 * Keeps a page in step with what the hotel is actually doing.
 *
 * Until now every page but the bell was a photograph taken when it opened. The
 * board left up at the desk all morning showed the morning; a room the
 * housekeeper had finished on her phone still sat dirty on the manager's
 * screen; a booking closed in one tab stayed open in the other. Nothing was
 * broken — nothing was asking.
 *
 * Three triggers, which is what working systems settle on (TanStack Query
 * refetches on window focus by default, and adds an interval for shared
 * dashboards):
 *
 *   - **a write anywhere in this app** — the same signal the bell listens to,
 *     so acting on something updates everything that shows it;
 *   - **coming back to the tab** — the moment a person's attention returns is
 *     exactly when stale data misleads them;
 *   - **a slow interval**, for pages other people change while you watch.
 *
 * The refresh is always a **background** one: `load(true)` must leave what is
 * on screen alone and swap the data in when it arrives. A spinner flashing over
 * a checklist someone is ticking is worse than the staleness it cures.
 *
 * A hidden tab asks for nothing. Coming back to it triggers a refresh anyway,
 * so a phone in a pocket costs nothing and is still current when it is looked
 * at again.
 */
export function useLiveData(
  load: (background?: boolean) => void,
  { poll = false }: { poll?: boolean } = {}
) {
  // Kept in a ref so a loader rebuilt on every render — most of them close over
  // page state — does not tear down and re-arm the listeners each time.
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return
      latest.current(true)
    }

    const stopListening = onDataChanged(refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    // And on coming back to the network. The hotel is up a mountain road and
    // the far rooms have thin signal: a phone that lost the connection mid-shift
    // otherwise sits on whatever it managed to fetch before the bars dropped.
    window.addEventListener('online', refresh)
    const timer = poll ? setInterval(refresh, SHARED_POLL_MS) : null

    return () => {
      stopListening()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
      if (timer) clearInterval(timer)
    }
  }, [poll])
}
