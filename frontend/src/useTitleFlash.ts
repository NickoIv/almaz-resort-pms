import { useEffect } from 'react'

const ALERT_TITLE = '⚠ Новое событие — Taura PMS'

/** Only used if the title is somehow already flashing when we first look. */
const FALLBACK_TITLE = 'Taura PMS'

const FLASH_MS = 1000

/**
 * Flashes the tab title while something is outstanding and nobody is looking.
 *
 * Only flashes when the tab is actually in the background: a title alternating
 * under someone's nose while they work is noise, and the point is to catch the
 * eye of a person who has switched away.
 *
 * The title to restore is read when the flashing starts, not at module load.
 * At import time the document may not have its title yet — that is exactly the
 * case under jsdom — and capturing an empty string then would blank the tab on
 * the first restore. It is read only while no flash is showing, so the warning
 * text can never be saved as the value to go back to.
 */
export function useTitleFlash(active: boolean): void {
  useEffect(() => {
    // Nothing outstanding: whatever the last run set is put back by its own
    // cleanup, so there is nothing to do here.
    if (!active) return

    const base = document.title === ALERT_TITLE ? FALLBACK_TITLE : document.title

    let timer: ReturnType<typeof setInterval> | null = null
    let alternate = false

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      document.title = base
    }

    const start = () => {
      if (timer !== null) return
      alternate = false
      timer = setInterval(() => {
        alternate = !alternate
        document.title = alternate ? ALERT_TITLE : base
      }, FLASH_MS)
    }

    // `hidden` covers switching tabs and minimising; hasFocus additionally
    // covers moving to another window with this tab still visible behind it.
    const sync = () => (document.hidden || !document.hasFocus() ? start() : stop())

    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('blur', sync)
    window.addEventListener('focus', sync)

    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('blur', sync)
      window.removeEventListener('focus', sync)
      stop()
    }
  }, [active])
}