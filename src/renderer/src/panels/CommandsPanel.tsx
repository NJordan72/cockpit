import { useCallback, useEffect, useState } from 'react'
import type { ActivityEntry } from '@shared/activity'
import type { CommandList, SavedCommand } from '@shared/commands'
import type { MenuItem, PaneSession } from '@shared/ipc'

/** Recent prompts offered by "Save a prompt". */
const RECENT = 12

export type RunWhere = 'new' | 'here'

interface Props {
  session: PaneSession | null
  visible: boolean
  /** Bumped after a command is saved, to read the list again. */
  revision: number
  onRun: (prompt: string, where: RunWhere) => void
  /** Open the save dialog with this prompt. */
  onSave: (prompt: string) => void
}

/** The full text of a logged prompt. */
export const promptText = (e: ActivityEntry): string => e.detail ?? e.text

/** Claude Code commands saved here or by hand, for the focused pane's repo and everywhere. */
export function CommandsPanel({
  session,
  visible,
  revision,
  onRun,
  onSave
}: Props): React.JSX.Element {
  const api = window.cockpit
  const [list, setList] = useState<CommandList | null>(null)
  const paneId = session?.id ?? null
  const cwd = session?.cwd ?? null
  const hasAgent =
    session?.agent !== undefined && session.agent !== null && session.status !== 'exited'

  const load = useCallback(() => {
    void api.commands.list(paneId).then(setList)
  }, [api, paneId])

  useEffect(() => {
    if (visible) load()
  }, [visible, cwd, revision, load])

  const run = (c: SavedCommand, where: RunWhere): void => onRun(`/${c.name}`, where)

  const menu = async (c: SavedCommand): Promise<void> => {
    const items: MenuItem[] = [
      { id: 'here', label: 'Run in this session', enabled: hasAgent },
      { id: 'new', label: 'Run in a new session' },
      { type: 'separator' },
      { id: 'edit', label: 'Save a copy as…' },
      { id: 'copy', label: 'Copy prompt' },
      { id: 'delete', label: `Delete /${c.name}` }
    ]
    switch (await api.menu(items)) {
      case 'here':
        run(c, 'here')
        return
      case 'new':
        run(c, 'new')
        return
      case 'edit':
        onSave(c.body)
        return
      case 'copy':
        api.clipboard.writeText(c.body)
        return
      case 'delete':
        if (window.confirm(`Delete /${c.name}? This removes ${c.path}.`)) {
          await api.commands.delete(paneId, c.name, c.scope)
          load()
        }
    }
  }

  /** A menu of the focused pane's latest prompts; the chosen one opens the save dialog. */
  const saveRecent = async (): Promise<void> => {
    if (!paneId || session?.agent !== 'claude') return
    const log = await api.activity.get(paneId)
    const prompts = log.entries
      .filter((e) => e.kind === 'prompt' && !e.agent && promptText(e).trim())
      .slice(-RECENT)
      .reverse()
    const items: MenuItem[] = prompts.length
      ? prompts.map((e) => ({ id: String(e.seq), label: e.text.slice(0, 80) }))
      : [{ id: 'none', label: 'No prompts in this pane yet', enabled: false }]
    const chosen = await api.menu(items)
    const entry = prompts.find((e) => String(e.seq) === chosen)
    if (entry) onSave(promptText(entry))
  }

  return (
    <div className="commands">
      <div className="activity-toolbar">
        <button
          type="button"
          tabIndex={-1}
          className="activity-chip"
          disabled={session?.agent !== 'claude'}
          title="Save one of this pane's recent prompts as a command"
          onClick={() => void saveRecent()}
        >
          + Save a prompt
        </button>
      </div>
      {!list ? null : list.commands.length === 0 ? (
        <p className="activity-empty">
          No commands yet. Save a prompt that worked, here or by right-clicking it in the Activity
          log.
        </p>
      ) : (
        <ol className="commands-list">
          {list.commands.map((c) => (
            <li key={`${c.scope}:${c.name}`}>
              <button
                type="button"
                tabIndex={-1}
                className="commands-row"
                title={`${c.body}\n\n${c.path}\nClick to run in this session (or a new one); right-click for more`}
                onClick={() => run(c, hasAgent ? 'here' : 'new')}
                onContextMenu={(e) => {
                  e.preventDefault()
                  void menu(c)
                }}
              >
                <span className="commands-name">/{c.name}</span>
                <span className="commands-scope">{c.scope === 'repo' ? 'repo' : 'global'}</span>
                {c.description && <span className="commands-desc">{c.description}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
