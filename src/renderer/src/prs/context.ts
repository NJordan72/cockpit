import { createContext } from 'react'
import type { PaneSession } from '@shared/ipc'
import type { TaskInfo } from '@shared/tasks'
import type { HandOffTarget } from './model'

/** What a pull request pane needs from the rest of the window to hand feedback to an agent. */
export interface PrPaneEnv {
  sessions: readonly PaneSession[]
  tasks: readonly TaskInfo[]
  /** False when nothing was sent: the chosen agent pane isn't running an agent. */
  handOff: (prompt: string, target: HandOffTarget) => Promise<boolean>
}

export const PrPaneContext = createContext<PrPaneEnv>({
  sessions: [],
  tasks: [],
  handOff: () => Promise.resolve(false)
})
