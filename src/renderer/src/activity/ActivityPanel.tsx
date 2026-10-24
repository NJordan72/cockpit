import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ActivityEntry,
  BashCommand,
  FileTouch,
  GitStatus,
  PaneActivity,
  SubagentRun
} from '@shared/activity'
import { ACTIVITY_TABS, type ActivityTab } from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import { formatAgo } from '../sessions'
import {
  filterLog,
  formatClock,
  formatDuration,
  gitCode,
  KIND_LABEL,
  loggedCount,
  splitPath,
  toggleFilter,
  type LogFilter
} from './model'
import { useGit, useNow, usePaneActivity } from './useActivity'

export interface ActivityView {
  tab: ActivityTab
  collapsed: boolean
}

interface Props {
  /** The focused pane. */
  session: PaneSession
  settings: ActivityView
  onChange: (next: ActivityView) => void
  /** Folding works only where the panel sits in a column. */
  canCollapse: boolean
  /** The panel is on screen. */
  visible: boolean
  /** Open the save-as-command dialog with a prompt from the log. */
  onSavePrompt: (prompt: string) => void
  /** Run a Bash command from the log in a new shell tab. */
  onRunCommand: (command: BashCommand) => void
}

const TAB_LABEL: Record<ActivityTab, string> = {
  log: 'Log',
  files: 'Files',
  agents: 'Agents',
  git: 'Git'
}

/** "5m ago" labels don't need to be fresher than this. */
const AGO_EVERY_MS = 30_000

interface FileFilter {
  edited: boolean
  read: boolean
}

/** What the focused pane's agent has been doing: its log, files, subagents, and git state. */
export function ActivityPanel({
  session,
  settings,
  onChange,
  canCollapse,
  visible,
  onSavePrompt,
  onRunCommand
}: Props): React.JSX.Element {
  const activity = usePaneActivity(session.id)
  const [logFilter, setLogFilter] = useState<LogFilter>({ events: true, tools: true })
  const [fileFilter, setFileFilter] = useState<FileFilter>({ edited: true, read: true })
  const edits = activity?.files.reduce((n, f) => n + f.edits, 0) ?? 0
  const git = useGit(session.id, visible, `${String(loggedCount(activity))}:${String(edits)}`)
  const open = !settings.collapsed
  const running = activity?.agents.some((a) => a.status === 'running') ?? false

  const counts: Record<ActivityTab, string> = {
    log: String(loggedCount(activity)),
    files: String(activity?.files.length ?? 0),
    agents: String(activity?.agents.length ?? 0),
    git: git === undefined ? '·' : git === null ? '–' : String(git.changed)
  }

  return (
    <section className={`activity${open ? '' : ' collapsed'}`} aria-label="Activity">
      <header
        className="sidebar-head activity-head frame-head"
        title={`${session.name} · ${session.cwd}`}
      >
        {canCollapse && (
          <button
            type="button"
            tabIndex={-1}
            className="widget-toggle"
            aria-expanded={open}
            title={open ? 'Hide activity' : 'Show activity'}
            onClick={() => onChange({ ...settings, collapsed: open })}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <div className="activity-tabs" role="tablist">
          {ACTIVITY_TABS.map((t) => (
            <button
              type="button"
              tabIndex={-1}
              role="tab"
              key={t}
              aria-selected={t === settings.tab}
              className={t === settings.tab && open ? 'on' : ''}
              onClick={() => onChange({ ...settings, tab: t, collapsed: false })}
            >
              {TAB_LABEL[t]}
              <span className={`activity-count${t === 'agents' && running ? ' live' : ''}`}>
                {counts[t]}
              </span>
            </button>
          ))}
        </div>
      </header>
      {open &&
        (settings.tab === 'log' ? (
          <LogView
            session={session}
            activity={activity}
            filter={logFilter}
            onFilter={setLogFilter}
            onSavePrompt={onSavePrompt}
            onRunCommand={onRunCommand}
          />
        ) : settings.tab === 'files' ? (
          <FilesView
            session={session}
            files={activity?.files ?? []}
            filter={fileFilter}
            onFilter={setFileFilter}
          />
        ) : settings.tab === 'agents' ? (
          <AgentsView agents={activity?.agents ?? []} running={running} />
        ) : (
          <GitView git={git} />
        ))}
    </section>
  )
}

function Chip({
  on,
  onClick,
  children
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`activity-chip${on ? ' on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** A log row's right-click menu, and the line its tooltip adds about it. */
interface RowMenu {
  hint: string
  open: () => void
}

async function commandMenu(c: BashCommand, onRun: (c: BashCommand) => void): Promise<void> {
  const api = window.cockpit
  const chosen = await api.menu([
    { id: 'copy', label: 'Copy command' },
    { id: 'run', label: 'Run in a new terminal' }
  ])
  if (chosen === 'copy') api.clipboard.writeText(c.text)
  else if (chosen === 'run') onRun(c)
}

async function fileMenu(file: string): Promise<void> {
  const api = window.cockpit
  const chosen = await api.menu([
    { id: 'edit', label: 'Open in editor' },
    { id: 'copy', label: 'Copy path' }
  ])
  if (chosen === 'edit') api.editor.openFile(file)
  else if (chosen === 'copy') api.clipboard.writeText(file)
}

async function promptMenu(prompt: string, onSave: () => void): Promise<void> {
  const api = window.cockpit
  const chosen = await api.menu([
    { id: 'save', label: 'Save as command…' },
    { id: 'copy', label: 'Copy prompt' }
  ])
  if (chosen === 'save') onSave()
  else if (chosen === 'copy') api.clipboard.writeText(prompt)
}

/** The right-click menu for a log entry, if it has one. */
function rowMenu(
  e: ActivityEntry,
  promptsSavable: boolean,
  onSavePrompt: (prompt: string) => void,
  onRunCommand: (command: BashCommand) => void
): RowMenu | undefined {
  const { command, file } = e
  if (command) {
    return {
      hint: 'Right-click to copy or run the command',
      open: () => void commandMenu(command, onRunCommand)
    }
  }
  if (file) return { hint: 'Right-click to open the file', open: () => void fileMenu(file) }
  if (e.kind === 'prompt' && !e.agent && promptsSavable) {
    const prompt = e.detail ?? e.text
    return {
      hint: 'Right-click to save as a command',
      open: () => void promptMenu(prompt, () => onSavePrompt(prompt))
    }
  }
  return undefined
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="activity-empty">{children}</p>
}

/**
 * Keeps a list scrolled to its end as rows arrive, unless the user scrolled
 * up. Returns the list's scroll handler.
 */
function useStickyScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  last: number | undefined,
  resetKey: string
): () => void {
  const stick = useRef(true)
  const key = useRef(resetKey)
  useLayoutEffect(() => {
    const el = ref.current
    if (key.current !== resetKey) {
      key.current = resetKey
      stick.current = true
    }
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [ref, last, resetKey])
  return () => {
    const el = ref.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }
}

function LogView({
  session,
  activity,
  filter,
  onFilter,
  onSavePrompt,
  onRunCommand
}: {
  session: PaneSession
  activity: PaneActivity | null
  filter: LogFilter
  onFilter: (f: LogFilter) => void
  onSavePrompt: (prompt: string) => void
  onRunCommand: (command: BashCommand) => void
}): React.JSX.Element {
  const entries = useMemo(() => activity?.entries ?? [], [activity])
  const shown = useMemo(() => filterLog(entries, filter), [entries, filter])
  const [openRow, setOpenRow] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const onScroll = useStickyScroll(scrollRef, shown.at(-1)?.seq, session.id)

  // Stable, so a new entry re-renders only its own row and not the whole log.
  const toggleRow = useCallback((key: string) => {
    setOpenRow((open) => (open === key ? null : key))
  }, [])
  const callbacks = useRef({ onSavePrompt, onRunCommand })
  useLayoutEffect(() => {
    callbacks.current = { onSavePrompt, onRunCommand }
  })
  const savePrompt = useCallback((prompt: string) => {
    callbacks.current.onSavePrompt(prompt)
  }, [])
  const runCommand = useCallback((command: BashCommand) => {
    callbacks.current.onRunCommand(command)
  }, [])

  return (
    <>
      <div className="activity-toolbar">
        <Chip on={filter.events} onClick={() => onFilter(toggleFilter(filter, 'events'))}>
          Events
        </Chip>
        <Chip on={filter.tools} onClick={() => onFilter(toggleFilter(filter, 'tools'))}>
          Tools
        </Chip>
        <span className="activity-total" title="Shown / logged">
          {shown.length}/{loggedCount(activity)}
        </span>
      </div>
      <div className="activity-scroll" ref={scrollRef} onScroll={onScroll}>
        {shown.length > 0 ? (
          <ol className="log">
            {shown.map((e) => {
              const key = `${session.id}:${String(e.seq)}`
              return (
                <LogRow
                  key={e.seq}
                  rowKey={key}
                  entry={e}
                  open={openRow === key}
                  onToggle={toggleRow}
                  // Codex logs only that a turn started, not what was asked.
                  promptsSavable={session.agent === 'claude'}
                  onSavePrompt={savePrompt}
                  onRunCommand={runCommand}
                />
              )
            })}
          </ol>
        ) : session.agent === null ? (
          <Empty>
            Only Claude Code and Codex panes report activity. This one runs {session.name}.
          </Empty>
        ) : (
          <Empty>Nothing yet.</Empty>
        )}
      </div>
    </>
  )
}

const LogRow = memo(function LogRow({
  rowKey,
  entry: e,
  open,
  onToggle,
  promptsSavable,
  onSavePrompt,
  onRunCommand
}: {
  rowKey: string
  entry: ActivityEntry
  open: boolean
  onToggle: (rowKey: string) => void
  promptsSavable: boolean
  onSavePrompt: (prompt: string) => void
  onRunCommand: (command: BashCommand) => void
}): React.JSX.Element {
  const when = new Date(e.at).toLocaleString()
  const menu = rowMenu(e, promptsSavable, onSavePrompt, onRunCommand)
  return (
    <li>
      <button
        type="button"
        tabIndex={-1}
        className={`log-row ${e.kind}${e.agent ? ' sub' : ''}${open ? ' open' : ''}`}
        title={(e.agent ? `${when} · in ${e.agent}` : when) + (menu ? `\n${menu.hint}` : '')}
        onClick={() => onToggle(rowKey)}
        onContextMenu={(ev) => {
          if (!menu) return
          ev.preventDefault()
          menu.open()
        }}
      >
        <span className="log-time">{formatClock(e.at)}</span>
        <span className="log-kind">{KIND_LABEL[e.kind]}</span>
        <span className="log-msg">
          {e.agent && <span className="log-sub">↳ </span>}
          {e.label && <span className="log-label">{e.label}</span>}
          {e.label && e.text && ' '}
          {open ? (e.detail ?? e.text) : e.text}
        </span>
      </button>
    </li>
  )
})

const CHANGE_LETTER: Record<FileTouch['change'], string> = { created: 'A', edited: 'M', read: 'R' }

function FilesView({
  session,
  files,
  filter,
  onFilter
}: {
  session: PaneSession
  files: FileTouch[]
  filter: FileFilter
  onFilter: (f: FileFilter) => void
}): React.JSX.Element {
  const shown = files.filter((f) => (f.change === 'read' ? filter.read : filter.edited))
  const now = useNow(AGO_EVERY_MS)
  return (
    <>
      <div className="activity-toolbar">
        <Chip on={filter.edited} onClick={() => onFilter(toggleFilter(filter, 'edited'))}>
          Changed
        </Chip>
        <Chip on={filter.read} onClick={() => onFilter(toggleFilter(filter, 'read'))}>
          Read
        </Chip>
        <span className="activity-total">
          {shown.length}/{files.length}
        </span>
      </div>
      <div className="activity-scroll">
        {shown.length > 0 ? (
          <ul className="activity-list">
            {shown.map((f) => {
              const [dir, base] = splitPath(f.display)
              const times = [
                f.edits ? `${String(f.edits)} edit${f.edits === 1 ? '' : 's'}` : '',
                f.reads ? `${String(f.reads)} read${f.reads === 1 ? '' : 's'}` : ''
              ]
              return (
                <li
                  key={f.path}
                  className="file-row"
                  title={`${f.path}\n${times.filter(Boolean).join(', ')}\nRight-click to open`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void fileMenu(f.path)
                  }}
                >
                  <span className={`file-change ${f.change}`}>{CHANGE_LETTER[f.change]}</span>
                  <span className="file-path">
                    {dir && <span className="file-dir">{dir}</span>}
                    <span className="file-base">{base}</span>
                  </span>
                  {(f.added > 0 || f.removed > 0) && (
                    <span className="file-lines">
                      {f.added > 0 && <span className="added">+{f.added}</span>}
                      {f.added > 0 && f.removed > 0 && ' '}
                      {f.removed > 0 && <span className="removed">−{f.removed}</span>}
                    </span>
                  )}
                  <span className="file-ago">{formatAgo(f.at, now)}</span>
                </li>
              )
            })}
          </ul>
        ) : session.agent === 'codex' ? (
          <Empty>Codex doesn&apos;t report the files it touches.</Empty>
        ) : (
          <Empty>No files touched yet.</Empty>
        )}
      </div>
    </>
  )
}

const RUN_DOT: Record<SubagentRun['status'], string> = {
  running: 'working',
  done: 'done',
  failed: 'exited',
  stopped: 'idle'
}

function AgentsView({
  agents,
  running
}: {
  agents: SubagentRun[]
  running: boolean
}): React.JSX.Element {
  const now = useNow(running ? 1000 : null)
  const newestFirst = [...agents].reverse()
  return (
    <div className="activity-scroll">
      {newestFirst.length > 0 ? (
        <ul className="activity-list">
          {newestFirst.map((a) => (
            <li key={a.id} className={`agent-row ${a.status}`} title={a.result ?? a.status}>
              <span className={`status-dot ${RUN_DOT[a.status]}`} />
              <span className="agent-main">
                <span className="agent-name">
                  {a.type}
                  {a.background && <span className="agent-tag">bg</span>}
                  {a.description && <span className="agent-desc"> {a.description}</span>}
                </span>
                {a.result && <span className="agent-result">{a.result}</span>}
              </span>
              <span className="agent-meta">
                <span>
                  {a.status === 'running' ? '' : `${a.status} · `}
                  {formatDuration((a.ended ?? Math.max(now, a.started)) - a.started)}
                </span>
                <span>
                  {a.tools} tool{a.tools === 1 ? '' : 's'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No subagents yet.</Empty>
      )}
    </div>
  )
}

function GitView({ git }: { git: GitStatus | null | undefined }): React.JSX.Element {
  const now = useNow(AGO_EVERY_MS)
  if (git === undefined) return <Empty>Reading git…</Empty>
  if (git === null) return <Empty>Not in a git repository.</Empty>
  return (
    <div className="activity-scroll">
      <div className="git-head" title={git.root}>
        <span className="git-branch">{git.branch ?? `detached at ${git.head ?? '?'}`}</span>
        {git.upstream && (
          <span className="git-upstream">
            {git.ahead > 0 && <span className="ahead">↑{git.ahead}</span>}
            {git.behind > 0 && <span className="behind">↓{git.behind}</span>}
            {git.ahead === 0 && git.behind === 0 && '='} {git.upstream}
          </span>
        )}
        <span className="git-root">{git.root}</span>
      </div>
      <h4 className="activity-subhead">
        Changes <span className="activity-count">{git.changed}</span>
      </h4>
      {git.files.length > 0 ? (
        <ul className="activity-list">
          {git.files.map((f) => {
            const [dir, base] = splitPath(f.path)
            return (
              <li
                key={f.path}
                className="file-row"
                title={f.from ? `${f.from} → ${f.path}` : f.path}
              >
                <span className={`git-xy${f.index === '?' ? ' untracked' : ''}`}>
                  <span className="staged">{gitCode(f)[0]}</span>
                  <span className="unstaged">{gitCode(f)[1]}</span>
                </span>
                <span className="file-path">
                  {dir && <span className="file-dir">{dir}</span>}
                  <span className="file-base">{base}</span>
                </span>
              </li>
            )
          })}
          {git.changed > git.files.length && (
            <li className="activity-more">and {git.changed - git.files.length} more</li>
          )}
        </ul>
      ) : (
        <Empty>Working tree clean.</Empty>
      )}
      {git.commits.length > 0 && (
        <>
          <h4 className="activity-subhead">Recent commits</h4>
          <ul className="activity-list">
            {git.commits.map((c) => (
              <li key={c.hash} className="commit-row" title={new Date(c.at).toLocaleString()}>
                <span className="commit-hash">{c.hash}</span>
                <span className="commit-subject">{c.subject}</span>
                <span className="file-ago">{formatAgo(c.at, now)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
