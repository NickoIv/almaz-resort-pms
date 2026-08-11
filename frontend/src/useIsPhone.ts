import { useEffect, useState } from 'react'

/**
 * Whether we are at phone width — the same 640px the stylesheet uses.
 *
 * This exists because some things have to *move* between two places rather
 * than exist in both and be hidden with CSS. Two copies in the DOM means a
 * screen reader reading the same thing twice, and a test finding two matches
 * where it expects one. CSS cannot move an element, so this is what the layout
 * asks JavaScript about.
 *
 * Used by the shell, where the account controls travel between the topbar and
 * the menu sheet, and by the journal, where fifty entries are either a table or
 * a column of cards but never both.
 */
const PHONE_QUERY = '(max-width: 640px)'

/**
 * Guarded: jsdom has no `matchMedia`, and an unguarded call took the whole
 * shell down rather than degrading to the desktop layout.
 */
export function phoneNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY).matches
    : false
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(phoneNow)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(PHONE_QUERY)
    const update = () => setIsPhone(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isPhone
}
