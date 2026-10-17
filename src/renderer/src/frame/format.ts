/** 51539607552 -> "48.0 GB" */
export function formatBytes(n: number): string {
  const gb = n / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(n / 1024 ** 2).toString()} MB`
}

/** Seconds since boot -> "2d 8h", "5h 12m", "12m". */
export function formatUptime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${String(d)}d ${String(h % 24)}h`
  if (h > 0) return `${String(h)}h ${String(m % 60)}m`
  return `${String(m)}m`
}

/** 0.1234 -> "12.3%" */
export const formatShare = (share: number): string => `${(share * 100).toFixed(1)}%`

/** How a meter is colored: calm, busy, or nearly full. */
export function meterLevel(share: number): 'ok' | 'high' | 'full' {
  return share >= 0.92 ? 'full' : share >= 0.8 ? 'high' : 'ok'
}
