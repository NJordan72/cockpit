import { useEffect, useRef, useState } from 'react'
import type { GitStatus, PaneActivity } from '@shared/activity'
import { applyUpdate } from './model'

/** How often git is read while the sidebar is showing. */
const GIT_POLL_MS = 10_000
/** How long after the agent did something git is read again (it may have edited or committed). */
const GIT_SETTLE_MS = 1200

/** A pane's activity, kept current. null until main has answered for this pane. */
export function usePaneActivity(paneId: string): PaneActivity | null {
  const api = window.cockpit
  const [activity, setActivity] = useState<PaneActivity | null>(null)

  useEffect(() => {
    let current: PaneActivity | null = null
    let cancelled = false
    // IPC keeps order, so updates that arrive before the snapshot are already in it.
    const off = api.activity.onUpdate((u) => {
      if (!current || u.paneId !== paneId) return
      current = applyUpdate(current, u)
      setActivity(current)
    })
    void api.activity.get(paneId).then((a) => {
      if (cancelled) return
      current = a
      setActivity(a)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [api, paneId])

  return activity?.paneId === paneId ? activity : null
}

/**
 * The pane's repository: undefined until it's been read, null when its
 * directory isn't in one. Read while `active`, and again shortly after
 * `changeKey` changes.
 */
export function useGit(
  paneId: string,
  active: boolean,
  changeKey: string
): GitStatus | null | undefined {
  const api = window.cockpit
  const [git, setGit] = useState<{ paneId: string; status: GitStatus | null } | null>(null)
  const load = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let busy = false
    const read = (): void => {
      if (busy) return
      busy = true
      void api.activity.git(paneId).then(
        (status) => {
          busy = false
          if (!cancelled) setGit({ paneId, status })
        },
        () => {
          busy = false
        }
      )
    }
    load.current = read
    read()
    const timer = setInterval(read, GIT_POLL_MS)
    window.addEventListener('focus', read)
    return () => {
      cancelled = true
      load.current = null
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [api, paneId, active])

  useEffect(() => {
    const t = setTimeout(() => load.current?.(), GIT_SETTLE_MS)
    return () => {
      clearTimeout(t)
    }
  }, [changeKey])

  return git?.paneId === paneId ? git.status : undefined
}

/** The time now, updated every `everyMs` (or held, when null). */
export function useNow(everyMs: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (everyMs === null) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, everyMs)
    return () => {
      clearInterval(timer)
    }
  }, [everyMs])
  return now
}
