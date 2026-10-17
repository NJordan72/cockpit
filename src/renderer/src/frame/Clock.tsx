import { useEffect, useState } from 'react'
import type { FramePanel } from '@shared/frame'

/** The time, ticking on the second (or minute) only while it's on screen. */
export function Clock({
  panel,
  visible
}: {
  panel: FramePanel
  visible: boolean
}): React.JSX.Element {
  const seconds = panel.seconds !== false
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!visible) return
    const step = seconds ? 1000 : 60_000
    let timer: ReturnType<typeof setTimeout>
    const tick = (): void => {
      const t = new Date()
      setNow(t)
      timer = setTimeout(tick, step - (t.getTime() % step) + 5)
    }
    tick()
    return () => {
      clearTimeout(timer)
    }
  }, [visible, seconds])

  // AM/PM goes small beside the digits, so the time keeps to one line.
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    ...(panel.hour12 === undefined ? {} : { hour12: panel.hour12 })
  }).formatToParts(now)
  const time = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim()
  const period = parts.find((p) => p.type === 'dayPeriod')?.value
  const date = now.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
  return (
    <div className="clock">
      <div className="clock-time">
        {time}
        {period && <span className="clock-period">{period}</span>}
      </div>
      {panel.date !== false && <div className="clock-date">{date}</div>}
    </div>
  )
}
