import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_KEYBINDINGS,
  validHost,
  type Action,
  type CockpitConfig,
  type Keybindings,
  type Preset,
  type SettingsPatch
} from '@shared/config'
import {
  ITEM_FIELDS,
  ITEM_KINDS,
  MAX_ITEM_ACTIONS,
  WORKTREE_KINDS,
  type ActionTarget,
  type ItemAction,
  type ItemActions,
  type ItemKind
} from '@shared/itemActions'
import {
  EFFORTS,
  inputPattern,
  MAX_QUICK_COMMANDS,
  type Effort,
  type QuickCommand
} from '@shared/quickCommands'
import { isRepoPath, type RepoTaskSettings, type TaskSettings } from '@shared/tasks'
import { chordLabel, parseChord } from '../keybindings'

interface Props {
  config: CockpitConfig
  onClose: () => void
}

type SettingsTab = 'general' | 'presets' | 'quickCommands' | 'itemActions' | 'tasks' | 'keybindings'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'presets', label: 'Presets' },
  { id: 'quickCommands', label: 'Quick Commands' },
  { id: 'itemActions', label: 'Item Actions' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'keybindings', label: 'Keybindings' }
]

const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  pr: 'Pull requests',
  task: 'Tasks',
  runItem: 'Run items',
  file: 'Activity files'
}

const ACTION_LABELS: Record<Action, string> = {
  newTab: 'New tab',
  newShell: 'New shell tab',
  newTask: 'New task',
  openUrl: 'Open web page',
  reloadPage: 'Reload web page',
  splitRight: 'Split right',
  splitDown: 'Split down',
  closePane: 'Close pane',
  clearPane: 'Clear pane',
  resumePane: 'Resume session',
  openEditor: 'Open project in editor',
  showPlan: 'Show plan',
  focusLeft: 'Focus pane left',
  focusRight: 'Focus pane right',
  focusUp: 'Focus pane up',
  focusDown: 'Focus pane down',
  nextTab: 'Next tab',
  prevTab: 'Previous tab',
  goToTab1: 'Go to tab 1',
  goToTab2: 'Go to tab 2',
  goToTab3: 'Go to tab 3',
  goToTab4: 'Go to tab 4',
  goToTab5: 'Go to tab 5',
  goToTab6: 'Go to tab 6',
  goToTab7: 'Go to tab 7',
  goToTab8: 'Go to tab 8',
  goToTab9: 'Go to tab 9',
  toggleSidebar: 'Toggle panels',
  kidsMode: 'Kids mode',
  quickCommand: 'Quick command',
  openSettings: 'Open Settings'
}

interface TaskRow {
  key: number
  repo: string
  setup: string
  copyText: string
}

interface QuickDraft {
  key: number
  id: string
  label: string
  preset: string
  prompt: string
  model: string
  effort: Effort | ''
  cwd: string
  background: boolean
  hasInput: boolean
  inputLabel: string
  inputPattern: string
}

const QUICK_ID = /^[A-Za-z0-9_-]{1,40}$/
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/

function toQuickDrafts(commands: readonly QuickCommand[]): QuickDraft[] {
  return commands.map((c, i) => ({
    key: i + 1,
    id: c.id,
    label: c.label,
    preset: c.preset,
    prompt: c.prompt,
    model: c.model ?? '',
    effort: c.effort ?? '',
    cwd: c.cwd ?? '',
    background: c.background,
    hasInput: c.input !== undefined,
    inputLabel: c.input?.label ?? 'Input',
    inputPattern: c.input?.pattern ?? ''
  }))
}

function toTaskRows(tasks: TaskSettings): TaskRow[] {
  return Object.entries(tasks).map(([repo, s], i) => ({
    key: i + 1,
    repo,
    setup: s.setup ?? '',
    copyText: s.copy.join('\n')
  }))
}

function chordKey(binding: string): string | null {
  const c = parseChord(binding)
  if (!c) return null
  return `${c.meta ? 'M' : ''}${c.ctrl ? 'C' : ''}${c.alt ? 'A' : ''}${c.shift ? 'S' : ''}:${c.code}`
}

/**
 * Tabbed in-app Settings dialog (Cmd+,). Edits General, Presets, Quick
 * Commands, Item Actions, Tasks, and Keybindings and writes validated updates
 * to ~/.cockpit/config.json through main.
 */
export function SettingsDialog({ config, onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // General
  const [editor, setEditor] = useState(config.editor ?? '')
  const [projectsDir, setProjectsDir] = useState(config.projectsDir)
  const [fontFamily, setFontFamily] = useState(config.terminal.fontFamily)
  const [fontSize, setFontSize] = useState(String(config.terminal.fontSize))
  const [scrollback, setScrollback] = useState(String(config.terminal.scrollback))
  const [copyOnSelect, setCopyOnSelect] = useState(config.terminal.copyOnSelect)

  // Presets
  const [presets, setPresets] = useState<Preset[]>(() => config.presets.map((p) => ({ ...p })))

  // Quick Commands
  const [quickNextKey, setQuickNextKey] = useState(config.quickCommands.length + 1)
  const [quickCommands, setQuickCommands] = useState<QuickDraft[]>(() =>
    toQuickDrafts(config.quickCommands)
  )

  // Item Actions
  const [itemKind, setItemKind] = useState<ItemKind>('pr')
  const [itemActions, setItemActions] = useState<ItemActions>(() => ({
    pr: config.itemActions.pr.map((a) => ({ ...a })),
    task: config.itemActions.task.map((a) => ({ ...a })),
    runItem: config.itemActions.runItem.map((a) => ({ ...a })),
    file: config.itemActions.file.map((a) => ({ ...a }))
  }))

  // Tasks
  const [taskNextKey, setTaskNextKey] = useState(Object.keys(config.tasks).length + 1)
  const [taskRows, setTaskRows] = useState<TaskRow[]>(() => toTaskRows(config.tasks))
  const [detectingKey, setDetectingKey] = useState<number | null>(null)

  // Keybindings
  const [keybindings, setKeybindings] = useState<Keybindings>(() => ({ ...config.keybindings }))

  const validationError = useMemo((): string | null => {
    const sizeNum = Number(fontSize)
    if (!Number.isFinite(sizeNum) || sizeNum < 6 || sizeNum > 48) {
      return 'Terminal font size must be between 6 and 48.'
    }
    const scrollNum = Number(scrollback)
    if (!Number.isInteger(scrollNum) || scrollNum < 0 || scrollNum > 100_000) {
      return 'Scrollback must be a whole number from 0 to 100000.'
    }
    if (!projectsDir.trim()) return 'Projects directory cannot be empty.'
    if (!fontFamily.trim()) return 'Terminal font family cannot be empty.'

    const presetIds = new Set<string>()
    for (const p of presets) {
      const id = p.id.trim()
      if (!id || !p.name.trim()) return 'Every preset needs an id and a name.'
      if (presetIds.has(id)) return `Duplicate preset id "${id}".`
      presetIds.add(id)
      if (p.host?.trim() && !validHost(p.host.trim())) {
        return `Preset "${p.name}" has an invalid SSH host.`
      }
    }

    const quickIds = new Set<string>()
    for (const q of quickCommands) {
      const id = q.id.trim()
      if (!QUICK_ID.test(id)) {
        return `Quick command id "${id || '(empty)'}" must use letters, digits, - or _.`
      }
      if (quickIds.has(id)) return `Duplicate quick command id "${id}".`
      quickIds.add(id)
      if (!q.label.trim() || !q.prompt.trim() || !q.preset.trim()) {
        return `Quick command "${id}" needs a label, preset, and prompt.`
      }
      if (q.model.trim() && !MODEL_RE.test(q.model.trim())) {
        return `Quick command "${q.label}" has an invalid model name.`
      }
      if (q.hasInput && q.inputPattern.trim() && !inputPattern(q.inputPattern.trim())) {
        return `Quick command "${q.label}" has an invalid regular expression.`
      }
    }

    for (const kind of ITEM_KINDS) {
      for (const a of itemActions[kind]) {
        if (!a.label.trim() || !a.command.trim()) {
          return `Every ${ITEM_KIND_LABELS[kind].toLowerCase()} action needs a label and command.`
        }
      }
    }

    const seenRepos = new Set<string>()
    for (const row of taskRows) {
      const repo = row.repo.trim().replace(/\/+$/, '')
      if (!/^[~/]/.test(repo)) {
        return `Task repository "${repo || '(empty)'}" must start with ~ or /.`
      }
      if (seenRepos.has(repo)) return `Duplicate task repository "${repo}".`
      seenRepos.add(repo)
      for (const line of row.copyText.split('\n')) {
        const p = line.trim().replace(/\/+$/, '')
        if (p && !isRepoPath(p)) {
          return `Copy path "${p}" in ${repo} must be relative with no "..".`
        }
      }
    }

    for (const action of Object.keys(DEFAULT_KEYBINDINGS) as Action[]) {
      const val = keybindings[action].trim()
      if (val && !parseChord(val)) {
        return `Keybinding for "${ACTION_LABELS[action]}" ("${val}") could not be parsed.`
      }
    }
    return null
  }, [
    fontSize,
    scrollback,
    projectsDir,
    fontFamily,
    presets,
    quickCommands,
    itemActions,
    taskRows,
    keybindings
  ])

  const duplicateChords = useMemo(() => {
    const counts = new Map<string, number>()
    for (const action of Object.keys(DEFAULT_KEYBINDINGS) as Action[]) {
      const k = chordKey(keybindings[action].trim())
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [keybindings])

  const save = async (): Promise<void> => {
    if (saving || validationError) return
    setSaving(true)
    setSaveError(null)
    const tasks: TaskSettings = {}
    for (const row of taskRows) {
      const repo = row.repo.trim().replace(/\/+$/, '')
      const copy = row.copyText
        .split('\n')
        .map((l) => l.trim().replace(/\/+$/, ''))
        .filter((l) => l.length > 0 && isRepoPath(l))
      const entry: RepoTaskSettings = { copy: [...new Set(copy)] }
      if (row.setup.trim()) entry.setup = row.setup.trim()
      tasks[repo] = entry
    }

    const patch: SettingsPatch = {
      editor: editor.trim() || null,
      projectsDir: projectsDir.trim(),
      terminal: {
        fontFamily: fontFamily.trim(),
        fontSize: Number(fontSize),
        scrollback: Number(scrollback),
        copyOnSelect
      },
      presets: presets.map((p) => {
        const out: Preset = { id: p.id.trim(), name: p.name.trim(), cwd: p.cwd.trim() || '~' }
        if (p.command?.trim()) out.command = p.command.trim()
        if (p.host?.trim()) out.host = p.host.trim()
        return out
      }),
      quickCommands: quickCommands.map((q) => {
        const out: QuickCommand = {
          id: q.id.trim(),
          label: q.label.trim(),
          preset: q.preset.trim(),
          prompt: q.prompt.trim(),
          background: q.background
        }
        if (q.model.trim()) out.model = q.model.trim()
        if (q.effort) out.effort = q.effort
        if (q.cwd.trim()) out.cwd = q.cwd.trim()
        if (q.hasInput) {
          out.input = {
            label: q.inputLabel.trim() || 'Input',
            ...(q.inputPattern.trim() ? { pattern: q.inputPattern.trim() } : {})
          }
        }
        return out
      }),
      itemActions: {
        pr: itemActions.pr.map((a) => ({
          label: a.label.trim(),
          command: a.command.trim(),
          ...(a.target ? { target: a.target } : {})
        })),
        task: itemActions.task.map((a) => ({
          label: a.label.trim(),
          command: a.command.trim(),
          ...(a.target ? { target: a.target } : {})
        })),
        runItem: itemActions.runItem.map((a) => ({
          label: a.label.trim(),
          command: a.command.trim(),
          ...(a.target ? { target: a.target } : {})
        })),
        file: itemActions.file.map((a) => ({
          label: a.label.trim(),
          command: a.command.trim(),
          ...(a.target ? { target: a.target } : {})
        }))
      },
      tasks,
      keybindings: Object.fromEntries(
        (Object.keys(DEFAULT_KEYBINDINGS) as Action[]).map((a) => [a, keybindings[a].trim()])
      )
    }

    try {
      await window.cockpit.config.save(patch)
      onClose()
    } catch (err: unknown) {
      setSaveError(String(err))
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault()
        onClose()
      } else if (e.metaKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const updatePreset = (index: number, patch: Partial<Preset>): void => {
    setPresets((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const updateQuick = (key: number, patch: Partial<QuickDraft>): void => {
    setQuickCommands((list) => list.map((q) => (q.key === key ? { ...q, ...patch } : q)))
  }

  const updateItemAction = (kind: ItemKind, index: number, patch: Partial<ItemAction>): void => {
    setItemActions((all) => ({
      ...all,
      [kind]: all[kind].map((a, i) => (i === index ? { ...a, ...patch } : a))
    }))
  }

  const updateTaskRow = (key: number, patch: Partial<TaskRow>): void => {
    setTaskRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const detectForRow = async (row: TaskRow): Promise<void> => {
    if (!row.repo.trim() || detectingKey !== null) return
    setDetectingKey(row.key)
    try {
      const suggestion = await window.cockpit.tasks.detectSetup(row.repo.trim())
      if (suggestion) {
        updateTaskRow(row.key, {
          repo: suggestion.repo,
          ...(suggestion.setup ? { setup: suggestion.setup } : {}),
          ...(suggestion.copy.length > 0 ? { copyText: suggestion.copy.join('\n') } : {})
        })
      }
    } finally {
      setDetectingKey(null)
    }
  }

  return (
    <div
      className="picker-backdrop"
      onMouseDown={() => {
        if (!saving) onClose()
      }}
    >
      <div
        className="secret-prompt settings-dialog"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <span className="settings-title">Settings</span>
          <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'on' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-body">
          {tab === 'general' && (
            <div className="settings-section">
              <div className="settings-field">
                <label className="secret-label" htmlFor="settings-editor">
                  Editor command
                </label>
                <input
                  id="settings-editor"
                  className="picker-input"
                  spellCheck={false}
                  placeholder="Default app (e.g. zed, code -g, cursor)"
                  value={editor}
                  onChange={(e) => setEditor(e.target.value)}
                />
                <span className="settings-help">
                  Runs through your login shell with the file or project path appended. Leave blank
                  for macOS default app / Finder.
                </span>
              </div>

              <div className="settings-field">
                <label className="secret-label" htmlFor="settings-projects-dir">
                  Projects directory
                </label>
                <input
                  id="settings-projects-dir"
                  className="picker-input"
                  spellCheck={false}
                  placeholder="~/dev"
                  value={projectsDir}
                  onChange={(e) => setProjectsDir(e.target.value)}
                />
                <span className="settings-help">
                  Subdirectories listed in the start screen and Cmd+T picker.
                </span>
              </div>

              <div className="settings-divider" />

              <div className="settings-field">
                <label className="secret-label" htmlFor="settings-font-family">
                  Terminal font family
                </label>
                <input
                  id="settings-font-family"
                  className="picker-input settings-mono"
                  spellCheck={false}
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                />
              </div>

              <div className="settings-row-2">
                <div className="settings-field">
                  <label className="secret-label" htmlFor="settings-font-size">
                    Font size (6–48)
                  </label>
                  <input
                    id="settings-font-size"
                    type="number"
                    min={6}
                    max={48}
                    className="picker-input settings-mono"
                    value={fontSize}
                    onChange={(e) => setFontSize(e.target.value)}
                  />
                </div>
                <div className="settings-field">
                  <label className="secret-label" htmlFor="settings-scrollback">
                    Scrollback lines (0–100000)
                  </label>
                  <input
                    id="settings-scrollback"
                    type="number"
                    min={0}
                    max={100_000}
                    step={500}
                    className="picker-input settings-mono"
                    value={scrollback}
                    onChange={(e) => setScrollback(e.target.value)}
                  />
                </div>
              </div>

              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={copyOnSelect}
                  onChange={(e) => setCopyOnSelect(e.target.checked)}
                />
                <span>Copy text to clipboard on mouse selection</span>
              </label>
            </div>
          )}

          {tab === 'presets' && (
            <div className="settings-section">
              <div className="settings-toolbar">
                <span className="settings-help">
                  Presets appear in the start screen and Cmd+T picker. Leave command empty for a
                  login shell; add an SSH host for remote machines.
                </span>
                <button
                  type="button"
                  className="settings-add"
                  onClick={() =>
                    setPresets((list) => [
                      ...list,
                      {
                        id: `preset-${String(list.length + 1)}`,
                        name: 'New Preset',
                        command: '',
                        cwd: projectsDir.trim() || '~'
                      }
                    ])
                  }
                >
                  + Add preset
                </button>
              </div>
              {presets.map((p, i) => {
                const isShell = p.id === 'shell'
                const hostInvalid = Boolean(p.host?.trim() && !validHost(p.host.trim()))
                return (
                  <div className="settings-card" key={`${String(i)}-${isShell ? 'shell' : 'item'}`}>
                    <div className="settings-card-grid">
                      <label className="settings-mini">
                        <span>ID</span>
                        <input
                          className="picker-input settings-mono"
                          spellCheck={false}
                          disabled={isShell}
                          value={p.id}
                          onChange={(e) => updatePreset(i, { id: e.target.value })}
                        />
                      </label>
                      <label className="settings-mini">
                        <span>Name</span>
                        <input
                          className="picker-input"
                          value={p.name}
                          onChange={(e) => updatePreset(i, { name: e.target.value })}
                        />
                      </label>
                      <label className="settings-mini">
                        <span>Command</span>
                        <input
                          className="picker-input settings-mono"
                          spellCheck={false}
                          placeholder="Interactive shell"
                          value={p.command ?? ''}
                          onChange={(e) => updatePreset(i, { command: e.target.value })}
                        />
                      </label>
                      <label className="settings-mini">
                        <span>Default cwd</span>
                        <input
                          className="picker-input settings-mono"
                          spellCheck={false}
                          placeholder="~"
                          value={p.cwd}
                          onChange={(e) => updatePreset(i, { cwd: e.target.value })}
                        />
                      </label>
                      <label className="settings-mini">
                        <span>SSH host (optional)</span>
                        <input
                          className={`picker-input settings-mono${hostInvalid ? ' invalid' : ''}`}
                          spellCheck={false}
                          placeholder="user@host"
                          value={p.host ?? ''}
                          onChange={(e) => updatePreset(i, { host: e.target.value })}
                        />
                      </label>
                      <div className="settings-card-actions">
                        <button
                          type="button"
                          disabled={isShell}
                          title={isShell ? 'The shell preset is required' : 'Remove preset'}
                          onClick={() => setPresets((list) => list.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'quickCommands' && (
            <div className="settings-section">
              <div className="settings-toolbar">
                <span className="settings-help">
                  Prompts launched from Cmd+Shift+J. Use <code>{'{input}'}</code> where typed or
                  clipboard input should be inserted.
                </span>
                <button
                  type="button"
                  className="settings-add"
                  disabled={quickCommands.length >= MAX_QUICK_COMMANDS}
                  onClick={() => {
                    const nextKey = quickNextKey
                    setQuickNextKey(nextKey + 1)
                    setQuickCommands((list) => [
                      ...list,
                      {
                        key: nextKey,
                        id: `cmd-${String(nextKey)}`,
                        label: 'New command',
                        preset: presets.find((p) => p.command)?.id ?? presets[0]?.id ?? 'shell',
                        prompt: '',
                        model: '',
                        effort: '',
                        cwd: '',
                        background: true,
                        hasInput: false,
                        inputLabel: 'Input',
                        inputPattern: ''
                      }
                    ])
                  }}
                >
                  + Add command
                </button>
              </div>
              {quickCommands.length === 0 ? (
                <p className="settings-empty">No quick commands configured yet.</p>
              ) : (
                quickCommands.map((q) => {
                  const badRegex = Boolean(
                    q.hasInput && q.inputPattern.trim() && !inputPattern(q.inputPattern.trim())
                  )
                  return (
                    <div className="settings-card" key={q.key}>
                      <div className="settings-card-grid">
                        <label className="settings-mini">
                          <span>ID</span>
                          <input
                            className={`picker-input settings-mono${q.id && !QUICK_ID.test(q.id.trim()) ? ' invalid' : ''}`}
                            spellCheck={false}
                            value={q.id}
                            onChange={(e) => updateQuick(q.key, { id: e.target.value })}
                          />
                        </label>
                        <label className="settings-mini">
                          <span>Label</span>
                          <input
                            className="picker-input"
                            value={q.label}
                            onChange={(e) => updateQuick(q.key, { label: e.target.value })}
                          />
                        </label>
                        <label className="settings-mini">
                          <span>Preset</span>
                          <select
                            className="picker-input"
                            value={q.preset}
                            onChange={(e) => updateQuick(q.key, { preset: e.target.value })}
                          >
                            {presets.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.id})
                              </option>
                            ))}
                            {!presets.some((p) => p.id === q.preset) && (
                              <option value={q.preset}>{q.preset} (missing)</option>
                            )}
                          </select>
                        </label>
                        <label className="settings-mini">
                          <span>Model (optional)</span>
                          <input
                            className={`picker-input settings-mono${q.model.trim() && !MODEL_RE.test(q.model.trim()) ? ' invalid' : ''}`}
                            spellCheck={false}
                            placeholder="opus, gpt-5.5"
                            value={q.model}
                            onChange={(e) => updateQuick(q.key, { model: e.target.value })}
                          />
                        </label>
                        <label className="settings-mini">
                          <span>Effort (optional)</span>
                          <select
                            className="picker-input"
                            value={q.effort}
                            onChange={(e) =>
                              updateQuick(q.key, { effort: e.target.value as Effort | '' })
                            }
                          >
                            <option value="">Default</option>
                            {EFFORTS.map((ef) => (
                              <option key={ef} value={ef}>
                                {ef}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="settings-mini">
                          <span>Directory (optional)</span>
                          <input
                            className="picker-input settings-mono"
                            spellCheck={false}
                            placeholder="Preset default"
                            value={q.cwd}
                            onChange={(e) => updateQuick(q.key, { cwd: e.target.value })}
                          />
                        </label>
                      </div>
                      <label className="settings-mini settings-full">
                        <span>Prompt</span>
                        <textarea
                          className="picker-input task-prompt"
                          rows={2}
                          spellCheck={false}
                          placeholder="/standup or /approve-ship {input}"
                          value={q.prompt}
                          onChange={(e) => updateQuick(q.key, { prompt: e.target.value })}
                        />
                      </label>
                      <div className="settings-inline-row">
                        <label className="settings-check">
                          <input
                            type="checkbox"
                            checked={q.background}
                            onChange={(e) => updateQuick(q.key, { background: e.target.checked })}
                          />
                          <span>Run in background</span>
                        </label>
                        <label className="settings-check">
                          <input
                            type="checkbox"
                            checked={q.hasInput}
                            onChange={(e) => updateQuick(q.key, { hasInput: e.target.checked })}
                          />
                          <span>Prompt for input</span>
                        </label>
                        <button
                          type="button"
                          className="settings-remove-inline"
                          onClick={() =>
                            setQuickCommands((list) => list.filter((x) => x.key !== q.key))
                          }
                        >
                          Remove
                        </button>
                      </div>
                      {q.hasInput && (
                        <div className="settings-row-2">
                          <label className="settings-mini">
                            <span>Input label</span>
                            <input
                              className="picker-input"
                              placeholder="Slack link"
                              value={q.inputLabel}
                              onChange={(e) => updateQuick(q.key, { inputLabel: e.target.value })}
                            />
                          </label>
                          <label className="settings-mini">
                            <span>Validation regex (optional)</span>
                            <input
                              className={`picker-input settings-mono${badRegex ? ' invalid' : ''}`}
                              spellCheck={false}
                              placeholder="^https://"
                              value={q.inputPattern}
                              onChange={(e) => updateQuick(q.key, { inputPattern: e.target.value })}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}

          {tab === 'itemActions' && (
            <div className="settings-section">
              <div className="settings-toolbar">
                <div className="picker-presets" role="tablist" aria-label="Item kind">
                  {ITEM_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={itemKind === kind}
                      className={itemKind === kind ? 'on' : ''}
                      onClick={() => setItemKind(kind)}
                    >
                      {ITEM_KIND_LABELS[kind]} ({itemActions[kind].length})
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="settings-add"
                  disabled={itemActions[itemKind].length >= MAX_ITEM_ACTIONS}
                  onClick={() =>
                    setItemActions((all) => ({
                      ...all,
                      [itemKind]: [...all[itemKind], { label: 'New action', command: '' }]
                    }))
                  }
                >
                  + Add action
                </button>
              </div>
              <p className="settings-help">
                Placeholders:{' '}
                {ITEM_FIELDS[itemKind].map((f) => (
                  <code key={f} className="settings-token">{`{${f}}`}</code>
                ))}
              </p>
              {itemActions[itemKind].length === 0 ? (
                <p className="settings-empty">
                  No right-click actions for {ITEM_KIND_LABELS[itemKind].toLowerCase()}.
                </p>
              ) : (
                itemActions[itemKind].map((a, i) => (
                  <div className="settings-card" key={`${itemKind}-${String(i)}`}>
                    <div className="settings-item-action-row">
                      <label className="settings-mini">
                        <span>Label</span>
                        <input
                          className="picker-input"
                          value={a.label}
                          onChange={(e) => updateItemAction(itemKind, i, { label: e.target.value })}
                        />
                      </label>
                      <label className="settings-mini">
                        <span>Command / Prompt</span>
                        <input
                          className="picker-input settings-mono"
                          spellCheck={false}
                          placeholder="/code-review"
                          value={a.command}
                          onChange={(e) =>
                            updateItemAction(itemKind, i, { command: e.target.value })
                          }
                        />
                      </label>
                      <label className="settings-mini">
                        <span>Target</span>
                        <select
                          className="picker-input"
                          value={a.target ?? ''}
                          onChange={(e) => {
                            const val = e.target.value as ActionTarget | ''
                            updateItemAction(itemKind, i, {
                              target: val || undefined
                            })
                          }}
                        >
                          <option value="">Submenu (ask)</option>
                          <option value="here">here (focused pane)</option>
                          <option value="new">new (new tab)</option>
                          {WORKTREE_KINDS.includes(itemKind) && (
                            <option value="worktree">worktree</option>
                          )}
                        </select>
                      </label>
                      <div className="settings-card-actions">
                        <button
                          type="button"
                          onClick={() =>
                            setItemActions((all) => ({
                              ...all,
                              [itemKind]: all[itemKind].filter((_, j) => j !== i)
                            }))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="settings-section">
              <div className="settings-toolbar">
                <span className="settings-help">
                  Per-repository files to copy from the main checkout and setup command to run in
                  each new task worktree.
                </span>
                <button
                  type="button"
                  className="settings-add"
                  onClick={() => {
                    const nextKey = taskNextKey
                    setTaskNextKey(nextKey + 1)
                    setTaskRows((list) => [
                      ...list,
                      {
                        key: nextKey,
                        repo: `${projectsDir.trim().replace(/\/+$/, '') || '~/dev'}/`,
                        setup: '',
                        copyText: ''
                      }
                    ])
                  }}
                >
                  + Add repository
                </button>
              </div>
              {taskRows.length === 0 ? (
                <p className="settings-empty">
                  No per-repository task settings yet. Creating a task in a repo with .env files or
                  a lockfile will also offer to auto-detect them.
                </p>
              ) : (
                taskRows.map((row) => (
                  <div className="settings-card" key={row.key}>
                    <div className="settings-row-2">
                      <label className="settings-mini">
                        <span>Repository path</span>
                        <input
                          className={`picker-input settings-mono${row.repo.trim() && !/^[~/]/.test(row.repo.trim()) ? ' invalid' : ''}`}
                          spellCheck={false}
                          placeholder="~/dev/cockpit"
                          value={row.repo}
                          onChange={(e) => updateTaskRow(row.key, { repo: e.target.value })}
                        />
                      </label>
                      <label className="settings-mini">
                        <span>Setup command (optional)</span>
                        <input
                          className="picker-input settings-mono"
                          spellCheck={false}
                          placeholder="bun install"
                          value={row.setup}
                          onChange={(e) => updateTaskRow(row.key, { setup: e.target.value })}
                        />
                      </label>
                    </div>
                    <label className="settings-mini settings-full">
                      <span>Files/folders to copy (one relative path per line)</span>
                      <textarea
                        className="picker-input task-prompt"
                        rows={2}
                        spellCheck={false}
                        placeholder={'.env\n.env.local'}
                        value={row.copyText}
                        onChange={(e) => updateTaskRow(row.key, { copyText: e.target.value })}
                      />
                    </label>
                    <div className="settings-inline-row">
                      <button
                        type="button"
                        disabled={!row.repo.trim() || detectingKey !== null}
                        onClick={() => void detectForRow(row)}
                      >
                        {detectingKey === row.key ? 'Detecting…' : 'Auto-detect'}
                      </button>
                      <button
                        type="button"
                        className="settings-remove-inline"
                        onClick={() => setTaskRows((list) => list.filter((r) => r.key !== row.key))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'keybindings' && (
            <div className="settings-section">
              <div className="settings-toolbar">
                <span className="settings-help">
                  Use <code>Cmd</code>, <code>Ctrl</code>, <code>Alt</code>, <code>Shift</code> +
                  key (e.g. <code>Cmd+Shift+D</code>). Clear a field to unbind.
                </span>
                <button
                  type="button"
                  className="settings-add"
                  onClick={() => setKeybindings({ ...DEFAULT_KEYBINDINGS })}
                >
                  Reset all defaults
                </button>
              </div>
              <div className="settings-keys">
                {(Object.keys(DEFAULT_KEYBINDINGS) as Action[]).map((action) => {
                  const val = keybindings[action]
                  const trimmed = val.trim()
                  const label = trimmed ? chordLabel(trimmed) : null
                  const invalid = Boolean(trimmed && !label)
                  const k = trimmed ? chordKey(trimmed) : null
                  const dup = Boolean(k && duplicateChords.has(k))
                  const isDefault = trimmed === DEFAULT_KEYBINDINGS[action]
                  return (
                    <div className="settings-key-row" key={action}>
                      <span className="settings-key-name">{ACTION_LABELS[action]}</span>
                      <input
                        className={`picker-input settings-mono${invalid ? ' invalid' : ''}`}
                        spellCheck={false}
                        aria-label={ACTION_LABELS[action]}
                        placeholder="Unbound"
                        value={val}
                        onChange={(e) =>
                          setKeybindings((prev) => ({ ...prev, [action]: e.target.value }))
                        }
                      />
                      <span
                        className={`settings-key-badge${invalid ? ' invalid' : dup ? ' warn' : ''}`}
                      >
                        {invalid ? 'Invalid' : dup ? `${label ?? ''} (dup)` : (label ?? 'Unbound')}
                      </span>
                      <button
                        type="button"
                        className="settings-key-reset"
                        disabled={isDefault}
                        title={`Reset to ${DEFAULT_KEYBINDINGS[action]}`}
                        onClick={() =>
                          setKeybindings((prev) => ({
                            ...prev,
                            [action]: DEFAULT_KEYBINDINGS[action]
                          }))
                        }
                      >
                        Reset
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="settings-foot">
          <span className={`settings-status${validationError || saveError ? ' error' : ''}`}>
            {saveError ??
              validationError ??
              'Changes save to ~/.cockpit/config.json and apply immediately.'}
          </span>
          <div className="secret-actions">
            <button type="button" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={saving || validationError !== null}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
