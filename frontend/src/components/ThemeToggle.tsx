import { useTheme } from '../theme'

/**
 * Night / day, next to the clock.
 *
 * A single button rather than a pair of radio buttons: there are two states
 * and the icon shows which one a press would bring, which is the shorter
 * explanation.
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const goingTo = theme === 'night' ? 'Taura Day' : 'Taura Night'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={`Переключить на ${goingTo}`}
      aria-label={`Переключить на ${goingTo}`}
    >
      {theme === 'night' ? (
        // Sun: what pressing this gets you.
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line
              key={angle}
              x1="12"
              y1="2.6"
              x2="12"
              y2="5.2"
              transform={`rotate(${angle} 12 12)`}
            />
          ))}
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
        </svg>
      )}
    </button>
  )
}
