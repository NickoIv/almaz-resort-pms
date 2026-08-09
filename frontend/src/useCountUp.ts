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
export function useCountUp(target: number, durationMs = 450): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  const frame = useRef<number>(0)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

    // A guaranteed landing, independent of the frame loop. Browsers throttle
    // requestAnimationFrame in a background tab, so a dashboard opened in a
    // tab nobody is looking at could otherwise sit on a partial figure until
    // it is focused — showing 4 where the answer is 6. This also stops the
    // animation being a source of flake in tests, where a loaded machine
    // starves the frame loop the same way.
    settle.current = setTimeout(() => setValue(target), durationMs + 100)

    return () => {
      cancelAnimationFrame(frame.current)
      clearTimeout(settle.current)
    }
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
