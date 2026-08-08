import { useEffect, useState } from 'react'
import { almatyClock, todayIso } from '../format'

/**
 * The hotel's local time, for staff working from another timezone.
 *
 * Ticks on the minute boundary rather than every 60s from mount, so the
 * display never sits up to a minute stale after the first render.
 */
export default function AlmatyClock() {
  const [time, setTime] = useState(() => almatyClock())

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

  return (
    <div className="clock" title={`Время в отеле · ${todayIso()}`}>
      <span className="clock-time">{time}</span>
      <span className="clock-zone">Алматы</span>
    </div>
  )
}
