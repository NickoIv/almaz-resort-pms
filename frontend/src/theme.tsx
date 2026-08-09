import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export const THEMES = ['night', 'day'] as const

export type Theme = (typeof THEMES)[number]

export const THEME_LABELS: Record<Theme, string> = {
  night: 'Taura Night',
  day: 'Taura Day',
}

const STORAGE_KEY = 'taura_pms_theme'

/** Matches the `<meta name="theme-color">` the browser chrome picks up. */
const BROWSER_CHROME: Record<Theme, string> = {
  night: '#12151a',
  day: '#f6f3ec',
}

function stored(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'day' ? 'day' : 'night'
  } catch {
    return 'night'
  }
}

type ThemeState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeState | null>(null)

/**
 * Night is the default: this is a hotel front desk, and most of a shift runs
 * after dark. The inline script in index.html has already put the saved theme
 * on <html> before React mounts, so there is no flash of the wrong palette;
 * this provider only keeps it in step from then on.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(stored)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', BROWSER_CHROME[theme])
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Private mode: the choice just will not survive a reload.
    }
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const toggle = useCallback(
    () => setThemeState((current) => (current === 'night' ? 'day' : 'night')),
    []
  )

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
