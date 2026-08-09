import { useEffect, useState } from 'react'
import { almatyClock, todayIso } from '../format'
import { hoursToClock, sunPosition } from '../sun'

/** Geometry of the dial, in its own 44×44 viewBox. */
const CENTRE = 22
const RADIUS = 17
/** Sweep of the arc: a shallow bowl, open at the bottom like a horizon. */
const START_ANGLE = 160
const END_ANGLE = 380

const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const SWEEP_FRACTION = (END_ANGLE - START_ANGLE) / 360

function pointAt(angleDegrees: number): { x: number; y: number } {
  const radians = angleDegrees * (Math.PI / 180)
  return {
    x: CENTRE + RADIUS * Math.cos(radians),
    y: CENTRE + RADIUS * Math.sin(radians),
  }
}

/**
 * The hotel's local time, with the sun's place in the day beside it.
 *
 * The one deliberately expressive thing in the interface. Everywhere else is
 * restrained, so this earns its keep: the arc is the daylight the hotel has
 * left, drawn from real sunrise and sunset for the gorge rather than a fixed
 * 06:00–18:00 guess — which in a mountain valley at 43°N would be wrong by
 * three hours between June and December.
 *
 * The time ticks on the minute boundary; the arc is redrawn every half minute
 * and eased by CSS, so the sun creeps rather than steps.
 */
export default function AlmatyClock() {
  const [time, setTime] = useState(() => almatyClock())
  const [sun, setSun] = useState(() => sunPosition())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const schedule = () => {
      const now = new Date()
      const msToNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds())
      timer = setTimeout(() => {
        setTime(almatyClock())
        schedule()
      }, msToNextMinute)
    }

    schedule()
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setSun(sunPosition()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const progress = sun.progress ?? 0
  const sunAngle = START_ANGLE + (END_ANGLE - START_ANGLE) * progress
  const dot = pointAt(sunAngle)

  // One dash of the right length, offset so the arc starts where it should.
  const dash = CIRCUMFERENCE * SWEEP_FRACTION
  const litDash = dash * progress

  const label = sun.isDay
    ? `Светло · восход ${hoursToClock(sun.sunrise)}, закат ${hoursToClock(sun.sunset)}`
    : `Тёмное время · восход ${hoursToClock(sun.sunrise)}`

  return (
    <div className="clock" title={`Время в отеле · ${todayIso()} · ${label}`}>
      <svg
        className={`sun-dial ${sun.isDay ? 'is-day' : 'is-night'}`}
        viewBox="0 0 44 44"
        role="img"
        aria-label={label}
      >
        {/* The whole day's sweep, unlit. */}
        <circle
          className="sun-track"
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          transform={`rotate(${START_ANGLE} ${CENTRE} ${CENTRE})`}
        />
        {/* How much of it has been used. */}
        <circle
          className="sun-progress"
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          strokeDasharray={`${litDash} ${CIRCUMFERENCE}`}
          transform={`rotate(${START_ANGLE} ${CENTRE} ${CENTRE})`}
        />
        {sun.isDay && <circle className="sun-dot" cx={dot.x} cy={dot.y} r={3.2} />}
        {!sun.isDay && <circle className="moon-dot" cx={CENTRE} cy={CENTRE} r={3.6} />}
      </svg>

      <span className="clock-stack">
        <span className="clock-time">{time}</span>
        <span className="clock-zone">Алматы</span>
      </span>
    </div>
  )
}
