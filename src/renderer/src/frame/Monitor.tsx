import { useEffect, useState } from 'react'
import type { SystemSample } from '@shared/ipc'
import { formatBytes, formatShare, formatUptime, meterLevel } from './format'

function Meter({ share }: { share: number }): React.JSX.Element {
  return (
    <div className={`meter ${meterLevel(share)}`}>
      <div className="meter-fill" style={{ width: formatShare(share) }} />
    </div>
  )
}

/** CPU, memory, load, and uptime. App turns sampling on while a System panel is visible. */
export function Monitor(): React.JSX.Element {
  const [s, setS] = useState<SystemSample | null>(null)
  useEffect(() => window.cockpit.system.onSample(setS), [])
  if (!s) return <div className="monitor monitor-wait">Reading…</div>
  const mem = s.memTotal > 0 ? s.memUsed / s.memTotal : 0
  return (
    <div className="monitor">
      <div className="monitor-row">
        <span className="monitor-label">CPU · {s.cores} cores</span>
        <span className="monitor-value">{formatShare(s.cpu)}</span>
      </div>
      <Meter share={s.cpu} />
      <div className="monitor-sub">Load {s.load.map((l) => l.toFixed(2)).join(' · ')}</div>
      <div className="monitor-row">
        <span className="monitor-label">Memory</span>
        <span className="monitor-value">{formatShare(mem)}</span>
      </div>
      <Meter share={mem} />
      <div className="monitor-sub">
        {formatBytes(s.memUsed)} of {formatBytes(s.memTotal)}
      </div>
      <div className="monitor-row">
        <span className="monitor-label">Uptime</span>
        <span className="monitor-value">{formatUptime(s.uptime)}</span>
      </div>
    </div>
  )
}
