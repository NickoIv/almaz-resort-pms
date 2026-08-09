import { useEffect, useRef, useState } from 'react'

/**
 * Counts a number up to its value once, on mount.
 *
 * Only the dashboard's headline figures use this. A number that animates every
 * time it changes would make the page feel unsettled; a number that rolls up
 * once as the page arrives reads as the page filling in.
 *
 * Anyone who has asked for reduced motion gets the final value immediately —
 * checked with matchMedia rather than left to CSS, because this is a
 * JavaScript animation that no stylesheet can switch off.
 */
export function useCountUp(target: number, durationMs = 650): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  const frame = useRef<number>(0)

  useEffect(() => {
    if (prefersReducedMotion() || target === 0) {
      setValue(target)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // Ease out: quick to most of the way, then settles.
      const eased = 1 - (1 - t) ** 3
      setValue(target * eased)
      if (t < 1) frame.current = requestAnimationFrame(tick)
      else setValue(target)
    }

    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [target, durationMs])

  return value
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
