import { createContext } from 'react'
import type { Preset } from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import type { AgentHandoffTarget } from './model'

/** What a terminal pane needs from the window to hand selected output to another agent. */
export interface AgentHandoffEnv {
  presets: readonly Preset[]
  sessions: readonly PaneSession[]
  /** False when nothing was sent (e.g. the target pane is no longer running an agent). */
  handOff: (prompt: string, target: AgentHandoffTarget) => Promise<boolean>
}

export const AgentHandoffContext = createContext<AgentHandoffEnv>({
  presets: [],
  sessions: [],
  handOff: () => Promise.resolve(false)
})
