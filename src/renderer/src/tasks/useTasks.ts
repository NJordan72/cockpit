import { useEffect, useState } from 'react'
import type { TaskInfo } from '@shared/tasks'

/** The tasks main knows about, kept up to date. */
export function useTasks(): TaskInfo[] {
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  useEffect(() => {
    const api = window.cockpit
    let cancelled = false
    let pushed = false
    const off = api.tasks.onChange((list) => {
      pushed = true
      setTasks(list)
    })
    // A change pushed while this is in flight is newer than its answer.
    void api.tasks.list().then((list) => {
      if (!cancelled && !pushed) setTasks(list)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return tasks
}
