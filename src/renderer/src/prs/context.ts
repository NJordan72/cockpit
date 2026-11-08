import { createContext } from 'react'
import type { PaneSession } from '@shared/ipc'
import type { TaskInfo } from '@shared/tasks'
import type { HandOffTarget } from './model'

/** What a pull request pane needs from the rest of the window to hand feedback to an agent. */
export interface PrPaneEnv {
  sessions: readonly PaneSession[]
  tasks: readonly TaskInfo[]
  handOff: (prompt: string, target: HandOffTarget) => void
}

export const PrPaneContext = createContext<PrPaneEnv>({
  sessions: [],
  tasks: [],
  handOff: () => undefined
})
