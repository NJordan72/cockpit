// CPU, memory, load, and uptime for the System panel. Sampled only while a
// System panel is on screen.
import { execFile } from 'node:child_process'
import os from 'node:os'
import type { SystemSample } from '@shared/ipc'

const INTERVAL_MS = 2000

export interface VmStat {
  pageSize: number
  /** "Pages wired down" -> 369909, keyed by the label vm_stat prints. */
  pages: Record<string, number>
}

export function parseVmStat(text: string): VmStat | null {
  const size = /page size of (\d+) bytes/.exec(text)?.[1]
  if (!size) return null
  const pages: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim())
    if (m?.[1] && m[2]) pages[m[1]] = Number(m[2])
  }
  return { pageSize: Number(size), pages }
}

/**
 * Memory in use the way Activity Monitor counts it: app memory (anonymous
 * pages that can't be purged), plus wired, plus what the compressor holds.
 */
export function memoryUsed(vm: VmStat): number | null {
  const p = vm.pages
  const anonymous = p['Anonymous pages']
  const purgeable = p['Pages purgeable'] ?? 0
  const wired = p['Pages wired down']
  const compressed = p['Pages occupied by compressor'] ?? 0
  if (anonymous === undefined || wired === undefined) return null
  return (anonymous - purgeable + wired + compressed) * vm.pageSize
}

interface CpuTimes {
  busy: number
  total: number
}

function cpuTimes(): CpuTimes {
  let busy = 0
  let total = 0
  for (const c of os.cpus()) {
    const t = c.times
    busy += t.user + t.nice + t.sys + t.irq
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { busy, total }
}

/** Share of CPU time spent busy between two readings, 0 to 1. */
export function cpuShare(a: CpuTimes, b: CpuTimes): number {
  const total = b.total - a.total
  return total > 0 ? Math.min(1, Math.max(0, (b.busy - a.busy) / total)) : 0
}

function vmStat(): Promise<VmStat | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/vm_stat', { timeout: 1500 }, (err, stdout) => {
      resolve(err ? null : parseVmStat(stdout))
    })
  })
}

export class SystemMonitor {
  private timer: NodeJS.Timeout | null = null
  private last: CpuTimes = cpuTimes()

  constructor(private readonly onSample: (s: SystemSample) => void) {}

  /** Sample while on, starting now. */
  set(on: boolean): void {
    if (on === (this.timer !== null)) return
    if (!on) {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      return
    }
    this.last = cpuTimes()
    this.timer = setInterval(() => void this.sample(), INTERVAL_MS)
    // CPU use needs two readings some time apart.
    setTimeout(() => void this.sample(), 300)
  }

  close(): void {
    this.set(false)
  }

  private async sample(): Promise<void> {
    const now = cpuTimes()
    const cpu = cpuShare(this.last, now)
    this.last = now
    const vm = await vmStat()
    const total = os.totalmem()
    const used = (vm && memoryUsed(vm)) ?? total - os.freemem()
    const [l1 = 0, l5 = 0, l15 = 0] = os.loadavg()
    if (this.timer === null) return
    this.onSample({
      cpu,
      cores: os.cpus().length,
      load: [l1, l5, l15],
      memUsed: Math.min(total, Math.max(0, used)),
      memTotal: total,
      uptime: os.uptime()
    })
  }
}
