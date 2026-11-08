import { useEffect, useState } from 'react'
import type { RunView } from '@shared/runs'

/** The runs main is working through, kept up to date. */
export function useRuns(): RunView[] {
  const [runs, setRuns] = useState<RunView[]>([])
  useEffect(() => {
    const api = window.cockpit
    let cancelled = false
    let pushed = false
    const off = api.runs.onChange((list) => {
      pushed = true
      setRuns(list)
    })
    // A change pushed while this is in flight is newer than its answer.
    void api.runs.list().then((list) => {
      if (!cancelled && !pushed) setRuns(list)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return runs
}
