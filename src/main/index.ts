import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  session,
  shell,
  type Display,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type WebContents,
  type WebPreferences
} from 'electron'
import {
  activeLayout,
  DEFAULT_KEYBINDINGS,
  defaultWindow,
  MAX_WINDOWS,
  isTerminalPane,
  paneIds,
  type AppearanceSettings,
  type LauncherSettings,
  type Layout,
  type LayoutNode,
  type PaneNode,
  type RecentPage,
  type WindowState,
  type WindowView
} from '@shared/config'
import { hasTerminals, widgetHomes, type FrameNode } from '@shared/frame'
import {
  IPC,
  type AppearanceCommand,
  type DirListing,
  type KidsCharacter,
  type PaneSession,
  type PtyCreateOptions,
  type PtyCreated,
  type RunResult,
  type WindowInfo
} from '@shared/ipc'
import type { SaveResult } from '@shared/commands'
import {
  isPrRef,
  MERGE_LABEL,
  prRefFromUrl,
  type PrAct,
  type PrActResult,
  type PrDetailResult,
  type PrList,
  type PrLogResult,
  type PrRef
} from '@shared/prs'
import {
  deletesBranch,
  MAX_BRANCH,
  mergedAndClean,
  removalWarnings,
  type NewTaskResult,
  type TaskDraft,
  type TaskInfo
} from '@shared/tasks'
import { BUILT_IN_LAYOUTS, DEFAULT_LAYOUT_ID, layoutChoices } from '@shared/layouts'
import {
  MAX_PARALLEL,
  RUN_ACTIONS,
  RUN_MODES,
  toWidgetRun,
  type RunAction,
  type RunDraft,
  type RunMode,
  type RunView
} from '@shared/runs'
import { resolveTheme, type ResolvedTheme } from '@shared/theme'
import { canOpenExternally, isWebUrl, WEB_PARTITION } from '@shared/web'
import { AgentMonitor } from './agents/monitor'
import { serveAssets } from './assets'
import { BranchTracker } from './branches'
import { ConfigStore } from './config'
import { listDirs, processCwd, processCwdSync, resolveCwd } from './dirs'
import { arrange, findDisplay, fitInto, mostlyOn, type DisplayInfo, type Rect } from './displays'
import { deleteCommand, listCommands, saveCommand } from './commands'
import { existingPaths, resolveIn } from './files'
import { editorCommand, openInEditor } from './editor'
import { gitRoot, gitStatus } from './git'
import { listCharacters } from './kids'
import { buildKidsMenu, buildMenu, menuTemplate } from './menu'
import { abbreviateHome, claudeHome, cockpitHome, codexHome, expandHome } from './paths'
import { actOnPr, checkLog, listPrs, readPr, readPrAct } from './prs'
import { PtyManager } from './pty'
import { runRequests, RunStore } from './runs'
import { registerSchemes } from './schemes'
import { SystemMonitor } from './system'
import { defaultBranch, mainCheckout, TaskStore, withSetup } from './tasks'
import { ThemeStore } from './themes'
import { restartPrompt, signedWithDeveloperId, Updates } from './updater'
import { TreeWatcher } from './watch'
import { WidgetHost } from './widgets/host'
import iconPath from '../../resources/icon.png?asset'
import { autoUpdater } from 'electron-updater'
import { listSessions, widgetSession } from './widgets/sessions'

// PTYs only start once the app is ready, by which time agents exists.
const ptys = new PtyManager({
  output: (id, data) => agents.output(id, data),
  input: (id, data) => agents.input(id, data),
  resized: (id) => agents.resized(id),
  exited: (id) => agents.exited(id),
  killed: (id) => agents.killed(id)
})
let config: ConfigStore
let themes: ThemeStore
let images: TreeWatcher
let imagesRevision = 0
const system = new SystemMonitor((sample) => {
  for (const w of windows) if (w.wantsSystem) send(w, IPC.systemSample, sample)
})
let widgets: WidgetHost
let agents: AgentMonitor
let tasks: TaskStore
let tasksTimer: NodeJS.Timeout | null = null
/** Null until startup makes it, since session changes can arrive before then. */
let runs: RunStore | null = null
/** Run notifications, kept so a click still reaches them. */
const runNotices = new Set<Notification>()
const branches = new BranchTracker(branchDir, () => sessionsChanged())
let branchesTimer: NodeJS.Timeout | null = null
let lastSessions = ''
let warnedNotifications = false
/**
 * Kids mode is on: its window is in kiosk mode, the others are hidden, the
 * menu has no shortcuts, and nothing typed reaches a PTY. Main owns this, so
 * it survives a chrome reload.
 */
let kidsActive = false
let kidsWindow: CockpitWindow | null = null
/** Set from before-quit: windows closing now are kept for the next launch. */
let quitting = false
/** Null in builds that can't install updates (see startUpdates). */
let updates: Updates | null = null
/** When a display was last added, removed, or changed. */
let displaysChangedAt = 0

/** An open window. Its layout, tabs, and place are its WindowState in config.json. */
interface CockpitWindow {
  id: string
  win: BrowserWindow
  /**
   * The chrome opens on the start screen, where the saved tabs are only
   * offered for restoring. They're live once the chrome sends a layout.
   */
  shown: boolean
  /** When it last had focus; the newest one with terminals is where the user works. */
  focusedAt: number
  /** A System panel is on screen in it. */
  wantsSystem: boolean
  /** The WindowInfo sent last, as JSON. */
  info: string
}

/** In config.json's order. */
const windows: CockpitWindow[] = []

registerSchemes()

function send(w: CockpitWindow, channel: string, ...args: unknown[]): void {
  if (!w.win.isDestroyed()) w.win.webContents.send(channel, ...args)
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of windows) send(w, channel, ...args)
}

function windowFor(wc: WebContents): CockpitWindow | null {
  return windows.find((w) => !w.win.isDestroyed() && w.win.webContents === wc) ?? null
}

function stateOf(w: CockpitWindow): WindowState | null {
  return config.get().windows.find((s) => s.id === w.id) ?? null
}

/** The tree of a window's layout. */
function treeOf(w: CockpitWindow): FrameNode {
  const c = config.get()
  return activeLayout(c.appearance, stateOf(w)?.layout ?? DEFAULT_LAYOUT_ID)
}

/** The tabs on screen in a window: its saved ones, once the chrome has shown them. */
function liveLayout(w: CockpitWindow): Layout {
  const state = stateOf(w)
  return w.shown && state ? { tabs: state.tabs, activeTabId: state.activeTabId } : NO_LAYOUT
}

/** Every window's tabs together. */
function allTabs(): Layout {
  return { tabs: windows.flatMap((w) => liveLayout(w).tabs), activeTabId: null }
}

/** The window focused now, or else the one focused last. */
function currentWindow(): CockpitWindow | null {
  return windows.reduce<CockpitWindow | null>(
    (best, w) => (!best || w.focusedAt > best.focusedAt ? w : best),
    null
  )
}

/**
 * The window with terminals the user worked in last, where actions from a
 * window of panels go. With `withTabs`, the last one that has tabs open:
 * Activity follows its pane, so a new window on its start screen doesn't
 * leave the panels empty.
 */
function terminalWindow(withTabs = false): CockpitWindow | null {
  return windows.reduce<CockpitWindow | null>(
    (best, w) =>
      hasTerminals(treeOf(w)) &&
      (!withTabs || liveLayout(w).tabs.length > 0) &&
      (!best || w.focusedAt > best.focusedAt)
        ? w
        : best,
    null
  )
}

/** The pane the user is working in: the active one in the terminal window. */
function focusedPaneId(): string | null {
  const w = terminalWindow(true)
  const layout = w ? liveLayout(w) : NO_LAYOUT
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)
  return tab && paneIds(tab.root).includes(tab.activePaneId) ? tab.activePaneId : null
}

function anyFocused(): boolean {
  return windows.some((w) => !w.win.isDestroyed() && w.win.isFocused())
}

const NO_LAYOUT: Layout = { tabs: [], activeTabId: null }

function sessions(): PaneSession[] {
  return listSessions(
    allTabs(),
    config.get().presets,
    {
      status: (id) => agents.status(id),
      branch: (id) => branches.get(id),
      labels: (id) => widgets.labels.of(id)
    },
    focusedPaneId()
  )
}

/** How often every pane's branch is read again while a window is on screen. */
const BRANCHES_POLL_MS = 5000

/**
 * Agents switch branches mid-turn, so HEAD is read again often. A pane's
 * directory is found again only when its status changes or its process
 * starts, since a shell that runs `cd` changes status too.
 */
function refreshBranches(): void {
  const ids = sessions().map((s) => s.id)
  branches.retain(new Set(ids))
  void branches.refresh(ids, true)
}

/** Push the session list to the chrome and to widgets that read it, if it changed. */
function sessionsChanged(): void {
  const list = sessions()
  const json = JSON.stringify(list)
  if (json !== lastSessions) {
    lastSessions = json
    broadcast(IPC.sessionsChanged, list)
    // The Dock shows how many panes want the user, notifications or not.
    const waiting = list.filter((s) => s.status === 'needs-input' || s.status === 'done').length
    app.dock?.setBadge(waiting > 0 ? String(waiting) : '')
    // A pane's status changed, or a tab opened or closed.
    runs?.poke()
  }
  widgets.sessionsChanged()
}

function findPaneNode(id: string): PaneNode | null {
  const find = (n: LayoutNode): PaneNode | null =>
    n.type === 'pane' ? (n.id === id ? n : null) : (n.children.map(find).find(Boolean) ?? null)
  for (const tab of allTabs().tabs) {
    const pane = find(tab.root)
    if (pane) return pane
  }
  return null
}

/** The window a pane is in. */
function windowOfPane(paneId: string): CockpitWindow | null {
  return (
    windows.find((w) => liveLayout(w).tabs.some((t) => paneIds(t.root).includes(paneId))) ?? null
  )
}

/** What each window's chrome is told about itself: its widgets, and how many windows there are. */
function windowInfo(w: CockpitWindow): WindowInfo {
  const installed = widgets.registry.list().map((i) => i.id)
  const homes = widgetHomes(windows.map(treeOf), installed)
  return {
    id: w.id,
    widgets: homes[windows.indexOf(w)] ?? [],
    count: windows.length,
    displays: screen.getAllDisplays().length
  }
}

/** Tell each window what changed about it: which widgets it shows, how many windows there are. */
function windowsChanged(): void {
  for (const w of windows) {
    const info = windowInfo(w)
    const json = JSON.stringify(info)
    if (json === w.info) continue
    w.info = json
    send(w, IPC.windowChanged, info)
  }
}

/** Where a pane's agent runs now: as its hooks last said, else its process's cwd, else where it started. */
async function paneCwd(paneId: string): Promise<string | null> {
  const pane = findPaneNode(paneId)
  if (!pane) return null
  let cwd = agents.activity.cwd(pane.id)
  if (!cwd) {
    const pid = ptys.pid(pane.id)
    cwd = pid === null ? null : await processCwd(pid)
  }
  return cwd ?? expandHome(pane.cwd)
}

/**
 * Where to read a pane's branch: like paneCwd, but undefined when lsof
 * couldn't say, so a slow lsof doesn't swap in the pane's start directory.
 */
async function branchDir(paneId: string): Promise<string | null | undefined> {
  const pane = findPaneNode(paneId)
  if (!pane) return null
  const hooked = agents.activity.cwd(pane.id)
  if (hooked) return hooked
  const pid = ptys.pid(pane.id)
  if (pid === null) return expandHome(pane.cwd)
  return (await processCwd(pid)) ?? undefined
}

/** How long after a display change window moves are macOS's, not the user's. */
const DISPLAY_SETTLE_MS = 2000

/** Longest prompt a panel or widget may type into a pane. */
const MAX_PROMPT = 20_000

/**
 * Types a prompt into a pane running Claude Code or Codex, as a bracketed
 * paste so newlines stay in the prompt, then presses Enter. The pause lets
 * the agent finish taking the paste, or it reads the Enter as part of it.
 */
function sendPrompt(paneId: string, prompt: string): boolean {
  const status = agents.status(paneId)
  const text = prompt.trim()
  if (!status?.agent || status.status === 'exited' || !text || text.length > MAX_PROMPT) {
    return false
  }
  // An ESC in the text could end the paste early, so none go through.
  ptys.write(paneId, `\x1b[200~${text.replaceAll('\x1b', '')}\x1b[201~`)
  setTimeout(() => ptys.write(paneId, '\r'), 150)
  return true
}

/** Asks the chrome of the terminal window to open a new agent session that starts with `prompt`. */
function openSession(prompt: string): boolean {
  const text = prompt.trim()
  const w = terminalWindow()
  if (!w || !text || text.length > MAX_PROMPT) return false
  send(w, IPC.sessionsOpen, { prompt: text })
  return true
}

/** Asks the chrome of the terminal window to show the New task dialog, filled in. */
function openTaskDraft(draft: TaskDraft): boolean {
  const w = terminalWindow()
  if (!w) return false
  raise(w)
  send(w, IPC.tasksDraft, draft)
  return true
}

/** Most urgent first, for the one status a run shows for a worktree's agents. */
const AGENT_URGENCY = ['needs-input', 'working', 'done', 'idle'] as const

/** The status of the agents running in a worktree, the most urgent one, or null with none. */
function agentIn(dir: string): (typeof AGENT_URGENCY)[number] | null {
  const statuses = panesIn(dir).flatMap((id) => {
    const s = agents.status(id)
    return s && s.agent !== null ? [s.status] : []
  })
  return AGENT_URGENCY.find((u) => statuses.includes(u)) ?? null
}

/**
 * Asks the terminal window to open a run item's agent in a tab, without
 * switching to it or raising the window.
 */
function openRunItem(req: { path: string; presetId: string; prompt: string }): boolean {
  const w = terminalWindow()
  if (!w) return false
  send(w, IPC.tasksOpen, { ...req, background: true })
  return true
}

/** Asks the terminal window to show the dialog that confirms a submitted run. */
function openRunDraft(draft: RunDraft): boolean {
  const w = terminalWindow()
  if (!w) return false
  raise(w)
  send(w, IPC.runsDraft, draft)
  return true
}

function runNotice(title: string, body: string, worktree: string | null): void {
  if (kidsActive || !Notification.isSupported()) return
  const n = new Notification({ title, body })
  runNotices.add(n)
  n.on('click', () => {
    const pane = worktree ? panesIn(worktree)[0] : undefined
    if (pane) revealPane(pane)
  })
  n.on('close', () => runNotices.delete(n))
  n.show()
}

/** How often the tasks are read again while a window is on screen. */
const TASKS_POLL_MS = 60_000
/** A window that gains focus reads them again if it's been this long. */
const TASKS_FOCUS_MS = 15_000

function anyVisible(): boolean {
  return windows.some((w) => !w.win.isDestroyed() && w.win.isVisible() && !w.win.isMinimized())
}

/** Terminal panes, in any window, that started in a directory inside `dir`. */
function panesIn(dir: string): string[] {
  const all = (n: LayoutNode): PaneNode[] => (n.type === 'pane' ? [n] : n.children.flatMap(all))
  return allTabs()
    .tabs.flatMap((t) => all(t.root))
    .filter((p) => isTerminalPane(p) && (p.cwd === dir || p.cwd.startsWith(`${dir}/`)))
    .map((p) => p.id)
}

/** Each window closes its own of these panes, and their processes end now. */
function closePanes(ids: string[]): void {
  if (ids.length === 0) return
  for (const w of windows) {
    const mine = new Set(liveLayout(w).tabs.flatMap((t) => paneIds(t.root)))
    const here = ids.filter((id) => mine.has(id))
    if (here.length > 0) send(w, IPC.panesClose, here)
  }
  for (const id of ids) ptys.kill(id)
}

const taskName = (t: TaskInfo): string => t.branch ?? basename(t.path)

/**
 * Closing and merging can't be taken back from Cockpit, so main asks first,
 * naming the pull request as GitHub has it now. Everything else just runs.
 */
async function confirmPrAct(ref: PrRef, act: PrAct): Promise<boolean> {
  if (act.type !== 'close' && act.type !== 'merge') return true
  const read = await readPr(ref)
  const name = read.ok ? `#${String(ref.number)} "${read.pr.title}"` : `#${String(ref.number)}`
  const base = read.ok ? read.pr.base : 'its base branch'
  const merging = act.type === 'merge'
  const { response } = await showDialog({
    type: 'question',
    message: merging
      ? `${MERGE_LABEL[act.method]} pull request ${name}?`
      : `Close pull request ${name}?`,
    detail: merging
      ? `${ref.repo}: it goes into ${base}. Its branch is kept.`
      : `${ref.repo}: it's closed without merging. Its branch is kept, and it can be reopened.`,
    buttons: [merging ? 'Merge' : 'Close Pull Request', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  return response === 0
}

/**
 * Removes a task after asking, unless nothing would be lost: its pull
 * request merged, nothing newer is in it, and no terminal is open there.
 */
async function removeTask(taskPath: string): Promise<boolean> {
  await tasks.refresh(true, taskPath)
  const task = tasks.list().find((t) => t.path === taskPath)
  if (!task) return false
  const panes = panesIn(task.path)
  const live = panes.filter((id) => ptys.pid(id) !== null).length
  const warnings = removalWarnings(task, live)
  if (warnings.length > 0) {
    const discard = task.changed > 0
    const { response } = await showDialog({
      type: discard ? 'warning' : 'question',
      message: `Remove the task ${taskName(task)}?`,
      detail: [
        `Its worktree, ${task.path}, is deleted.`,
        ...(deletesBranch(task)
          ? [`So is its local branch ${task.branch ?? ''}: its pull request merged.`]
          : []),
        ...warnings
      ].join('\n'),
      buttons: [discard ? 'Discard Changes and Remove' : 'Remove', 'Cancel'],
      defaultId: discard ? 1 : 0,
      cancelId: 1
    })
    if (response !== 0) return false
  }
  closePanes(panes)
  const r = await tasks.remove(task.path, {
    force: task.changed > 0,
    deleteBranch: deletesBranch(task)
  })
  if (!r.ok) {
    void showDialog({
      type: 'warning',
      message: `Could not remove ${taskName(task)}`,
      detail: r.error,
      buttons: ['OK']
    })
  }
  return r.ok
}

/** Removes, after one question, every task whose pull request merged with nothing newer in it. */
async function cleanUpTasks(): Promise<number> {
  await tasks.refresh(true)
  const done = tasks.list().filter(mergedAndClean)
  if (done.length === 0) {
    void showDialog({
      message: 'No merged tasks to clean up',
      detail:
        "A task is cleaned up once GitHub has merged its pull request and it has nothing that isn't in it.",
      buttons: ['OK']
    })
    return 0
  }
  const panes = done.flatMap((t) => panesIn(t.path))
  const live = panes.filter((id) => ptys.pid(id) !== null).length
  const { response } = await showDialog({
    type: 'question',
    message:
      done.length === 1 ? 'Remove 1 merged task?' : `Remove ${String(done.length)} merged tasks?`,
    detail: [
      ...done.map((t) => `${basename(t.repo)}: ${taskName(t)} (#${String(t.pr?.number ?? '')})`),
      '',
      'Their worktrees and local branches are deleted.',
      ...(live > 0
        ? [`${String(live)} ${live === 1 ? 'terminal' : 'terminals'} in them will close.`]
        : [])
    ].join('\n'),
    buttons: ['Remove', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (response !== 0) return 0
  closePanes(panes)
  const failed: string[] = []
  let removed = 0
  for (const t of done) {
    const r = await tasks.remove(t.path, { force: false, deleteBranch: true })
    if (r.ok) removed++
    else failed.push(`${taskName(t)}: ${r.error}`)
  }
  if (failed.length > 0) {
    void showDialog({
      type: 'warning',
      message:
        failed.length === 1 ? 'A task could not be removed' : 'Some tasks could not be removed',
      detail: failed.join('\n'),
      buttons: ['OK']
    })
  }
  return removed
}

/** Tell the monitor which pane the user is looking at, so a finished turn counts as seen. */
function updateFocus(): void {
  // Kids mode covers the panes; a turn that ends meanwhile is still news later.
  // With Cockpit in front, the pane last worked in counts as seen, whichever
  // of its windows has the keyboard.
  agents.setFocused(!anyFocused() || kidsActive ? null : focusedPaneId())
}

/** Bring a window forward. */
function raise(w: CockpitWindow): void {
  const win = w.win
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  app.focus({ steal: true })
  win.focus()
}

/** A notification or another window asked for a pane: bring its window forward and focus it. */
function revealPane(paneId: string): void {
  const w = windowOfPane(paneId)
  if (!w) return
  raise(w)
  send(w, IPC.paneFocus, paneId)
}

function currentTheme(): ResolvedTheme {
  const c = config.get()
  return resolveTheme(
    themes.list(),
    c.appearance.theme,
    c.appearance.overrides,
    c.terminal.fontFamily
  )
}

/** The window's own background shows while the chrome loads and around resizes. */
function windowBackground(): string {
  const bg = currentTheme().tokens.bg
  return /^#[0-9a-f]{3,8}$/i.test(bg) ? bg : '#1e1f24'
}

/** Only a built-in layout the user has changed can go back to how it was. */
function canResetLayout(layout: string): boolean {
  const a = config.get().appearance
  return BUILT_IN_LAYOUTS.some((l) => l.id === layout) && layout in a.layouts
}

/** The chrome owns the appearance; menu choices go to the current window's to apply and save. */
function sendAppearance(command: AppearanceCommand): void {
  const w = currentWindow()
  if (w) send(w, IPC.appearanceCommand, command)
}

/** Kids mode gets a menu with nothing in it to quit, hide, or close with. */
function applyMenu(): void {
  const current = currentWindow()
  const layout = (current && stateOf(current)?.layout) ?? DEFAULT_LAYOUT_ID
  Menu.setApplicationMenu(
    kidsActive
      ? buildKidsMenu({ onAbout: showAbout })
      : buildMenu({
          onAbout: showAbout,
          update: updates && {
            ...updates.menuItem(),
            onClick: () => updates?.checkNow()
          },
          onKidsMode: () => setKids(true, currentWindow()),
          themes: themes.list(),
          theme: currentTheme().id,
          onTheme: (id) => sendAppearance({ type: 'theme', id }),
          layouts: layoutChoices(config.get().appearance),
          layout,
          onLayout: (id) => sendAppearance({ type: 'layout', id }),
          onResetLayout: () => sendAppearance({ type: 'resetLayout' }),
          canResetLayout: canResetLayout(layout),
          onTogglePanels: () => sendAppearance({ type: 'togglePanels' }),
          onOpenFolder: () => void shell.openPath(cockpitHome()),
          windows: windows.length,
          displays: screen.getAllDisplays().length,
          onWindows: (count) => void setWindowCount(count, currentWindow())
        })
  )
}

/** The appearance or the theme files changed: follow them outside the chrome. */
function appearanceChanged(): void {
  applyMenu()
  const bg = windowBackground()
  for (const w of windows) if (!w.win.isDestroyed()) w.win.setBackgroundColor(bg)
}

/** A dialog on the current window, or on its own when there is none. */
function showDialog(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const win = currentWindow()?.win
  return win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options)
}

/**
 * Checks GitHub Releases for a newer Cockpit. macOS only installs an update
 * signed by the same Developer ID as the running app, so development and
 * ad-hoc builds leave updates off.
 */
async function startUpdates(): Promise<void> {
  if (!app.isPackaged || !(await signedWithDeveloperId(process.execPath))) return
  const u = new Updates({
    currentVersion: app.getVersion(),
    check: () => autoUpdater.checkForUpdates(),
    install: () => {
      prepareToQuit()
      autoUpdater.quitAndInstall()
    },
    askToRestart: async (version) =>
      (await showDialog(restartPrompt(version, sessions()))).response === 0,
    tell: (message, detail) => void showDialog({ message, detail, buttons: ['OK'] }),
    canAsk: () => !kidsActive,
    onChange: applyMenu
  })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => u.available(info.version))
  autoUpdater.on('update-not-available', () => u.notAvailable())
  autoUpdater.on('update-downloaded', (info) => u.downloaded(info.version))
  autoUpdater.on('error', (err) => u.failed(err))
  updates = u
  u.start()
  applyMenu()
}

/**
 * macOS's standard About panel shows the app bundle's icon, which is
 * Electron's while Cockpit runs unpackaged.
 */
function showAbout(): void {
  void showDialog({
    icon: nativeImage.createFromPath(iconPath),
    message: 'Cockpit',
    detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}`,
    buttons: ['OK']
  })
}

/** Opens a file or folder in config.json's editor, and says so when that fails. */
async function openEditor(target: string): Promise<void> {
  const { editor } = config.get()
  const found = await stat(target).then(
    () => true,
    () => false
  )
  const err = found ? await openInEditor(editor, target) : 'It no longer exists.'
  if (!err) return
  void showDialog({
    type: 'warning',
    message: `Could not open ${abbreviateHome(target)}`,
    detail: editor && found ? `${editorCommand(editor, target)}\n\n${err}` : err,
    buttons: ['OK']
  })
}

/**
 * Kids mode takes over one window. Kiosk mode only covers that window's
 * display, so the other windows are hidden until it ends.
 */
function setKids(active: boolean, from: CockpitWindow | null = null): void {
  if (active === kidsActive) return
  const target = active ? (from ?? currentWindow()) : kidsWindow
  if (active && !target) return
  kidsActive = active
  kidsWindow = active ? target : null
  for (const w of windows) {
    if (w.win.isDestroyed()) continue
    // Kiosk mode on macOS also turns off Cmd+Tab, force quit, and hiding.
    if (w === target) w.win.setKiosk(active)
    else if (active) w.win.hide()
    else w.win.showInactive()
  }
  applyMenu()
  updateFocus()
  // Run items wait while kids mode is on.
  if (!active) runs?.poke()
  if (target) send(target, IPC.kidsChanged, active)
}

/** Record where each live pane's process is now, so a relaunch reopens it there. */
function captureCwds(only?: CockpitWindow): void {
  const pids = ptys.pids()
  if (pids.size === 0) return
  const update = (n: LayoutNode): LayoutNode => {
    if (n.type === 'split') return { ...n, children: n.children.map(update) }
    const pid = pids.get(n.id)
    const cwd = pid === undefined ? null : processCwdSync(pid)
    return cwd ? { ...n, cwd: abbreviateHome(cwd) } : n
  }
  const live = new Set(windows.filter((w) => w.shown && (!only || w === only)).map((w) => w.id))
  config.setWindows(
    config
      .get()
      .windows.map((s) =>
        live.has(s.id) ? { ...s, tabs: s.tabs.map((t) => ({ ...t, root: update(t.root) })) } : s
      )
  )
}

function displayInfos(): (DisplayInfo & { display: Display })[] {
  return screen
    .getAllDisplays()
    .map((d) => ({ id: d.id, label: d.label, workArea: d.workArea, display: d }))
}

/**
 * Where a window opens: where it was, on the display it was on if that's
 * still there, or else on the display nearest to where it was.
 */
function placement(state: WindowState): Rect | undefined {
  if (!state.bounds) return undefined
  const home =
    findDisplay(displayInfos(), state.display)?.display ?? screen.getDisplayMatching(state.bounds)
  return fitInto(state.bounds, home.workArea)
}

/**
 * Remember where the user put a window. Moves macOS makes when a display is
 * unplugged or changes aren't remembered, so the window can go back when the
 * display returns.
 */
function savePlacement(w: CockpitWindow): void {
  const win = w.win
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
  if (Date.now() - displaysChangedAt < DISPLAY_SETTLE_MS) return
  const bounds = win.getNormalBounds()
  const d = screen.getDisplayMatching(bounds)
  config.updateWindow(w.id, (s) => ({ ...s, bounds, display: { id: d.id, label: d.label } }))
}

/** A display came back: windows that were on it go back to where they were. */
function returnToDisplay(display: Display): void {
  const info = [{ id: display.id, label: display.label, workArea: display.workArea }]
  for (const w of windows) {
    const state = stateOf(w)
    if (w.win.isDestroyed() || w.win.isFullScreen() || !state?.bounds) continue
    if (!findDisplay(info, state.display)) continue
    if (mostlyOn(w.win.getBounds(), display.workArea)) continue
    w.win.setBounds(fitInto(state.bounds, display.workArea))
  }
}

function newWindowId(): string {
  const taken = new Set(config.get().windows.map((s) => s.id))
  for (let n = 2; ; n++) if (!taken.has(`w${String(n)}`)) return `w${String(n)}`
}

/**
 * Open or close windows until there are `count`, then put them on the
 * displays: one each while there are enough, side by side past that. The
 * newest windows close first, after asking if terminals would end with them.
 */
async function setWindowCount(count: number, from: CockpitWindow | null): Promise<void> {
  const n = Math.min(MAX_WINDOWS, Math.max(1, Math.round(count)))
  if (kidsActive) return
  const closing = windows.slice(n)
  if (closing.length > 0) {
    const running = closing.flatMap((w) => liveLayout(w).tabs.flatMap((t) => paneIds(t.root)))
    const live = running.filter((id) => ptys.pid(id) !== null).length
    if (live > 0) {
      const many = closing.length > 1
      const { response } = await showDialog({
        type: 'warning',
        message: many ? `Close ${String(closing.length)} windows?` : 'Close the newest window?',
        detail: `${String(live)} ${live === 1 ? 'terminal' : 'terminals'} in ${many ? 'them' : 'it'} will end.`,
        buttons: [many ? 'Close Windows' : 'Close Window', 'Cancel'],
        defaultId: 0,
        cancelId: 1
      })
      if (response !== 0) {
        applyMenu()
        return
      }
    }
    for (const w of closing) if (!w.win.isDestroyed()) w.win.close()
  }
  const open = windows.slice(0, n)
  const current = open.map((w) =>
    w.win.isDestroyed() ? null : screen.getDisplayMatching(w.win.getBounds()).id
  )
  const rects = arrange(displayInfos(), n, current)
  open.forEach((w, i) => {
    const r = rects[i]
    if (!r || w.win.isDestroyed()) return
    if (w.win.isFullScreen()) w.win.setFullScreen(false)
    w.win.setBounds(r)
  })
  // A new window copies the layout of the one it was asked from, if that has terminals.
  const source = from ? stateOf(from) : null
  const layout =
    source && hasTerminals(activeLayout(config.get().appearance, source.layout))
      ? source.layout
      : DEFAULT_LAYOUT_ID
  for (let i = open.length; i < n; i++) {
    const state: WindowState = { ...defaultWindow(newWindowId(), layout) }
    const r = rects[i]
    if (r) state.bounds = r
    config.setWindows([...config.get().windows, state])
    createWindow(state)
  }
  for (const w of windows) savePlacement(w)
  windowsChanged()
  applyMenu()
}

function createWindow(state: WindowState): void {
  const bounds = placement(state)
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    ...bounds,
    minWidth: 480,
    minHeight: 300,
    show: false,
    backgroundColor: windowBackground(),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Web panes. will-attach-webview below decides what each one gets.
      webviewTag: true
    }
  })
  const w: CockpitWindow = {
    id: state.id,
    win,
    shown: false,
    // The first window counts as the one in use until another is focused.
    focusedAt: windows.length === 0 ? 1 : 0,
    wantsSystem: false,
    info: ''
  }
  windows.push(w)

  win.once('ready-to-show', () => win.show())
  win.on('focus', () => {
    w.focusedAt = Date.now()
    updateFocus()
    applyMenu()
    // The pane the user works in may now be in this window.
    sessionsChanged()
    // An agent may have pushed or opened a pull request meanwhile.
    if (Date.now() - tasks.lastScan > TASKS_FOCUS_MS) void tasks.refresh()
  })
  win.on('blur', updateFocus)
  win.on('moved', () => savePlacement(w))
  win.on('resized', () => savePlacement(w))

  // The chrome is a single page. Anything that tries to navigate away or open
  // a window is a link the user clicked; send http(s) ones to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const wc = win.webContents
  widgets.attach(wc)
  // A reload starts the renderer over; its old PTYs have no view any more.
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      ptys.killAllFor(wc)
      // Prompts nobody else can answer end; the new page takes widgets again.
      widgets.detach(wc)
      widgets.attach(wc)
      w.wantsSystem = false
      updateSystem()
      w.shown = false
      w.info = ''
      lastSessions = ''
      sessionsChanged()
    }
  })
  win.on('close', () => {
    // Quitting keeps every window for the next launch, and closing the last
    // one keeps it to restore. Closing any other window is for good.
    if (!quitting) {
      if (windows.length > 1) config.setWindows(config.get().windows.filter((s) => s.id !== w.id))
      else captureCwds(w)
    }
    // While the window still exists, so kiosk mode is turned off on it.
    if (w === kidsWindow) setKids(false)
  })
  win.on('closed', () => {
    const i = windows.indexOf(w)
    if (i >= 0) windows.splice(i, 1)
    ptys.killAllFor(wc)
    widgets.detach(wc)
    updateSystem()
    updateFocus()
    sessionsChanged()
    windowsChanged()
    applyMenu()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  windowsChanged()
  applyMenu()
}

/** System readings are taken while any window shows a System panel. */
function updateSystem(): void {
  system.set(windows.some((w) => w.wantsSystem))
}

/** Only accept IPC from our own top-level chrome frame. */
function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  if (!frame || frame.parent) return false
  return BrowserWindow.fromWebContents(e.sender) !== null
}

function registerIpc(): void {
  ipcMain.handle(IPC.ptyCreate, async (e, opts: PtyCreateOptions): Promise<PtyCreated> => {
    if (!trusted(e)) throw new Error('untrusted sender')
    const preset = config.get().presets.find((p) => p.id === opts.presetId)
    if (!preset) throw new Error(`unknown preset: ${opts.presetId}`)
    const cwd = await resolveCwd(opts.cwd, preset.cwd)
    // A command meant for that directory mustn't run anywhere else.
    if (opts.strictCwd && cwd !== expandHome(opts.cwd ?? '')) {
      throw new Error(`not a directory: ${opts.cwd ?? '(none)'}`)
    }
    const launch = agents.launch(preset.command, {
      resume: opts.resume === true,
      prompt: opts.prompt
    })
    const env = agents.spawn(opts.id, launch.agent)
    // A new task's worktree runs its repository's setup first, once.
    const setup = tasks.takeSetup(cwd)
    let pid: number
    try {
      ;({ pid } = ptys.create(e.sender, {
        id: opts.id,
        cols: opts.cols,
        rows: opts.rows,
        command: setup ? withSetup(setup, launch.command) : launch.command,
        cwd,
        env
      }))
    } catch (err) {
      agents.killed(opts.id)
      throw err
    }
    const display = abbreviateHome(cwd)
    if (display !== '~') config.addRecentDir(display, preset.id)
    sessionsChanged()
    void branches.refresh([opts.id])
    return { pid, cwd: display }
  })
  // Kids mode covers the panes. If a key gets past it anyway, it stops here.
  ipcMain.on(IPC.ptyWrite, (e, id: string, data: string) => {
    if (trusted(e) && !kidsActive) ptys.write(id, data)
  })
  // Not stopped by kids mode: a pane left unacknowledged would stay paused.
  ipcMain.on(IPC.ptyAck, (e, id: unknown, chars: unknown) => {
    if (trusted(e) && typeof id === 'string' && typeof chars === 'number' && chars > 0) {
      ptys.ack(id, chars)
    }
  })
  ipcMain.on(IPC.ptyResize, (e, id: string, cols: number, rows: number) => {
    if (trusted(e)) ptys.resize(id, cols, rows)
  })
  ipcMain.on(IPC.ptyKill, (e, id: string) => {
    if (trusted(e) && !kidsActive) ptys.kill(id)
  })
  ipcMain.handle(IPC.ptyCwd, async (e, id: string) => {
    if (!trusted(e)) return null
    const pid = ptys.pid(id)
    const cwd = pid === null ? null : await processCwd(pid)
    return cwd ? abbreviateHome(cwd) : null
  })
  ipcMain.handle(IPC.clipboardRead, (e) => (trusted(e) ? clipboard.readText() : ''))
  ipcMain.on(IPC.clipboardWrite, (e, text: string) => {
    if (trusted(e) && typeof text === 'string') void clipboard.writeText(text)
  })
  ipcMain.handle(IPC.configGet, (e) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return config.get()
  })
  ipcMain.on(IPC.layoutSave, (e, layout: unknown) => {
    const w = windowFor(e.sender)
    if (!trusted(e) || !w || typeof layout !== 'object' || layout === null) return
    const { tabs, activeTabId } = layout as Partial<Layout>
    // The store runs it through migration, so a bad layout can't corrupt the file.
    config.updateWindow(w.id, (s) => ({ ...s, tabs: tabs ?? [], activeTabId: activeTabId ?? null }))
    w.shown = true
    updateFocus()
    sessionsChanged()
  })
  ipcMain.on(IPC.appearanceSave, (e, appearance: AppearanceSettings) => {
    const from = windowFor(e.sender)
    if (!trusted(e) || !from) return
    config.setAppearance(appearance)
    // Every window shares it; the one that saved it has it already.
    const saved = config.get().appearance
    for (const w of windows) if (w !== from) send(w, IPC.appearanceChanged, saved)
    appearanceChanged()
    // A layout edit can move a widget between windows.
    windowsChanged()
  })
  ipcMain.handle(IPC.windowInfo, (e) => {
    const w = windowFor(e.sender)
    if (!trusted(e) || !w) throw new Error('untrusted sender')
    const info = windowInfo(w)
    w.info = JSON.stringify(info)
    return info
  })
  ipcMain.on(IPC.windowSave, (e, view: unknown) => {
    const w = windowFor(e.sender)
    if (!trusted(e) || !w || typeof view !== 'object' || view === null) return
    const { layout, panelsHidden, hiddenDirs } = view as Partial<WindowView>
    // The store migrates the window, which drops hiddenDirs entries that aren't paths.
    config.updateWindow(w.id, (s) => ({
      ...s,
      layout: typeof layout === 'string' ? layout : s.layout,
      panelsHidden: typeof panelsHidden === 'boolean' ? panelsHidden : s.panelsHidden,
      hiddenDirs: Array.isArray(hiddenDirs) ? hiddenDirs : s.hiddenDirs
    }))
    // Its widgets, the menu's checkmark, and the pane the user works in may all follow.
    windowsChanged()
    applyMenu()
    updateFocus()
    sessionsChanged()
  })
  ipcMain.on(IPC.windowCount, (e, count: unknown) => {
    const w = windowFor(e.sender)
    if (trusted(e) && typeof count === 'number' && Number.isFinite(count)) {
      void setWindowCount(count, w)
    }
  })
  // A window without terminals passes pane actions to the window with them.
  ipcMain.on(IPC.windowForward, (e, action: unknown) => {
    const target = terminalWindow()
    if (!trusted(e) || !target || target.win.webContents === e.sender) return
    if (typeof action !== 'string' || !(action in DEFAULT_KEYBINDINGS)) return
    raise(target)
    send(target, IPC.appAction, action)
  })
  ipcMain.on(IPC.sessionsReveal, (e, paneId: unknown) => {
    if (trusted(e) && typeof paneId === 'string') revealPane(paneId)
  })
  ipcMain.handle(IPC.themesList, (e) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return themes.list()
  })
  ipcMain.handle(IPC.sessionsList, (e) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return sessions()
  })
  ipcMain.handle(IPC.activityGet, (e, paneId: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string') throw new Error('untrusted sender')
    return agents.activity.snapshot(paneId)
  })
  ipcMain.handle(IPC.activityGit, async (e, paneId: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string') return null
    const cwd = await paneCwd(paneId)
    return cwd ? gitStatus(cwd) : null
  })
  ipcMain.handle(IPC.sessionsSend, (e, paneId: unknown, prompt: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string' || typeof prompt !== 'string') return false
    return sendPrompt(paneId, prompt)
  })
  ipcMain.handle(IPC.prsList, async (e, paneId: unknown): Promise<PrList> => {
    if (!trusted(e) || typeof paneId !== 'string') return { ok: false, error: 'No pane' }
    const cwd = await paneCwd(paneId)
    return cwd ? listPrs(cwd) : { ok: false, error: 'No pane' }
  })
  ipcMain.handle(IPC.prsView, (e, pr: unknown): Promise<PrDetailResult> | PrDetailResult => {
    if (!trusted(e) || !isPrRef(pr)) return { ok: false, error: 'Not a pull request' }
    return readPr(pr)
  })
  ipcMain.handle(IPC.prsAct, async (e, pr: unknown, act: unknown): Promise<PrActResult> => {
    if (!trusted(e) || !isPrRef(pr)) return { ok: false, error: 'Not a pull request' }
    if (kidsActive) return { ok: false, error: 'Not while kids mode is on' }
    const checked = readPrAct(act)
    if (!checked) return { ok: false, error: 'That action is missing something' }
    if (!(await confirmPrAct(pr, checked))) return { ok: false, cancelled: true }
    return actOnPr(pr, checked)
  })
  ipcMain.handle(
    IPC.prsLog,
    (e, pr: unknown, jobId: unknown): Promise<PrLogResult> | PrLogResult => {
      if (
        !trusted(e) ||
        !isPrRef(pr) ||
        typeof jobId !== 'number' ||
        !Number.isSafeInteger(jobId)
      ) {
        return { ok: false, error: 'Not a job' }
      }
      return checkLog(pr, jobId)
    }
  )
  // A window of panels opens pull request panes in the window with terminals.
  ipcMain.on(IPC.prsPane, (e, req: unknown) => {
    const target = terminalWindow()
    if (!trusted(e) || !target || typeof req !== 'object' || req === null) return
    const { pr, cwd, title, where } = req as Record<string, unknown>
    if (!isPrRef(pr)) return
    raise(target)
    send(target, IPC.prsPane, {
      pr: { repo: pr.repo, number: pr.number },
      cwd: typeof cwd === 'string' && cwd.length < 4096 ? cwd : '~',
      ...(typeof title === 'string' ? { title: title.slice(0, 200) } : {}),
      where: where === 'row' ? 'row' : 'tab'
    })
  })
  ipcMain.handle(IPC.tasksList, (e): TaskInfo[] => {
    if (!trusted(e)) throw new Error('untrusted sender')
    if (Date.now() - tasks.lastScan > TASKS_FOCUS_MS) void tasks.refresh()
    return tasks.list()
  })
  ipcMain.on(IPC.tasksRefresh, (e, force: unknown) => {
    if (trusted(e)) void tasks.refresh(force === true)
  })
  ipcMain.handle(IPC.tasksCreate, async (e, req: unknown): Promise<NewTaskResult> => {
    if (!trusted(e) || typeof req !== 'object' || req === null) {
      return { ok: false, error: 'untrusted sender' }
    }
    const { repo, branch } = req as Record<string, unknown>
    if (typeof repo !== 'string' || typeof branch !== 'string' || !repo.trim()) {
      return { ok: false, error: 'A task needs a repository and a branch' }
    }
    if (repo.length > 1024 || branch.length > MAX_BRANCH) {
      return { ok: false, error: 'That name is too long' }
    }
    const made = await tasks.create({ repo, branch })
    // Its pull request, if the branch has one already.
    if (made.ok) void tasks.refresh()
    return made
  })
  ipcMain.handle(IPC.tasksRemove, (e, path: unknown) => {
    if (!trusted(e) || typeof path !== 'string' || kidsActive) return false
    return removeTask(path)
  })
  ipcMain.handle(IPC.tasksCleanUp, (e) => {
    if (!trusted(e) || kidsActive) return 0
    return cleanUpTasks()
  })
  // A window of panels opens task tabs in the window with terminals.
  ipcMain.on(IPC.tasksOpen, (e, req: unknown) => {
    const target = terminalWindow()
    if (!trusted(e) || !target || typeof req !== 'object' || req === null) return
    const { path, presetId } = req as Record<string, unknown>
    if (typeof path !== 'string' || !tasks.list().some((t) => t.path === path)) return
    raise(target)
    send(target, IPC.tasksOpen, {
      path,
      ...(typeof presetId === 'string' ? { presetId } : {})
    })
  })
  ipcMain.handle(IPC.runsList, (e): RunView[] => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return runs?.list() ?? []
  })
  ipcMain.handle(IPC.runsStart, async (e, req: unknown): Promise<RunResult> => {
    if (!trusted(e) || !runs || typeof req !== 'object' || req === null) {
      return { ok: false, error: 'untrusted sender' }
    }
    const { id, mode, maxParallel, presetId, repo } = req as Record<string, unknown>
    if (
      typeof id !== 'string' ||
      !RUN_MODES.includes(mode as RunMode) ||
      typeof maxParallel !== 'number' ||
      maxParallel > MAX_PARALLEL ||
      typeof presetId !== 'string' ||
      !config.get().presets.some((p) => p.id === presetId) ||
      (repo !== undefined && (typeof repo !== 'string' || repo.length > 1024))
    ) {
      return { ok: false, error: "Cockpit can't start the run with those choices" }
    }
    return runs.confirm({
      id,
      mode: mode as RunMode,
      maxParallel,
      presetId,
      ...(typeof repo === 'string' ? { repo } : {})
    })
  })
  ipcMain.on(IPC.runsDiscard, (e, id: unknown) => {
    if (trusted(e) && typeof id === 'string') runs?.discard(id)
  })
  ipcMain.handle(IPC.runsAct, (e, id: unknown, action: unknown, itemId: unknown) => {
    if (
      !trusted(e) ||
      !runs ||
      typeof id !== 'string' ||
      !RUN_ACTIONS.includes(action as RunAction) ||
      (itemId !== undefined && typeof itemId !== 'string')
    ) {
      return { ok: false, error: 'untrusted sender' }
    }
    return runs.act(id, action as RunAction, itemId)
  })
  ipcMain.on(IPC.openGitHub, (e, url: unknown) => {
    if (trusted(e) && typeof url === 'string' && url.startsWith('https://github.com/')) {
      void shell.openExternal(url)
    }
  })
  ipcMain.on(IPC.openWeb, (e, url: unknown) => {
    if (trusted(e) && typeof url === 'string' && canOpenExternally(url)) {
      void shell.openExternal(url)
    }
  })
  ipcMain.handle(IPC.filesExisting, async (e, paneId: unknown, paths: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string' || !Array.isArray(paths)) return []
    const cwd = await paneCwd(paneId)
    if (!cwd) return []
    return existingPaths(
      cwd,
      paths.filter((p): p is string => typeof p === 'string')
    )
  })
  ipcMain.on(IPC.filesOpen, (e, paneId: unknown, p: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string' || typeof p !== 'string') return
    void (async () => {
      const cwd = await paneCwd(paneId)
      if (!cwd) return
      const [found] = await existingPaths(cwd, [p])
      if (!found) return
      const err = await shell.openPath(resolveIn(cwd, found))
      if (err) console.warn(`could not open ${found}: ${err}`)
    })()
  })
  ipcMain.on(IPC.editorFile, (e, p: unknown) => {
    if (trusted(e) && typeof p === 'string' && isAbsolute(expandHome(p))) {
      void openEditor(expandHome(p))
    }
  })
  // The repository the pane is in, or its directory when it isn't in one.
  ipcMain.on(IPC.editorProject, (e, paneId: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string') return
    void (async () => {
      const cwd = await paneCwd(paneId)
      if (cwd) await openEditor((await gitRoot(cwd)) ?? cwd)
    })()
  })
  ipcMain.handle(IPC.commandsList, async (e, paneId: unknown) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return listCommands(typeof paneId === 'string' ? await paneCwd(paneId) : null)
  })
  ipcMain.handle(
    IPC.commandsSave,
    async (e, paneId: unknown, req: unknown): Promise<SaveResult> => {
      if (!trusted(e) || typeof req !== 'object' || req === null) {
        return { ok: false, error: 'untrusted sender' }
      }
      const r = req as Record<string, unknown>
      if (typeof r.name !== 'string' || typeof r.body !== 'string') {
        return { ok: false, error: 'A command needs a name and a prompt' }
      }
      const cwd = typeof paneId === 'string' ? await paneCwd(paneId) : null
      return saveCommand({
        name: r.name,
        scope: r.scope === 'repo' ? 'repo' : 'global',
        body: r.body,
        description: typeof r.description === 'string' ? r.description : undefined,
        overwrite: r.overwrite === true,
        cwd: cwd ?? app.getPath('home')
      })
    }
  )
  ipcMain.handle(IPC.commandsDelete, async (e, paneId: unknown, name: unknown, scope: unknown) => {
    if (!trusted(e) || typeof name !== 'string') return false
    const cwd = typeof paneId === 'string' ? await paneCwd(paneId) : null
    return deleteCommand(cwd, name, scope === 'repo' ? 'repo' : 'global')
  })
  ipcMain.handle(IPC.menuPopup, (e, items: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!trusted(e) || !win || !Array.isArray(items)) return null
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      Menu.buildFromTemplate(menuTemplate(items, (id) => (chosen = id))).popup({
        window: win,
        callback: () => resolve(chosen)
      })
    })
  })
  ipcMain.on(IPC.systemWatch, (e, on: unknown) => {
    const w = windowFor(e.sender)
    if (!trusted(e) || !w) return
    w.wantsSystem = on === true
    updateSystem()
  })
  ipcMain.on(IPC.launcherSave, (e, launcher: LauncherSettings) => {
    if (trusted(e)) config.setLauncher(launcher)
  })
  // Only the window kids mode took over shows it.
  ipcMain.handle(IPC.kidsGet, (e) => trusted(e) && kidsActive && kidsWindow === windowFor(e.sender))
  ipcMain.on(IPC.kidsSet, (e, active: unknown) => {
    if (trusted(e) && typeof active === 'boolean') setKids(active, windowFor(e.sender))
  })
  ipcMain.handle(IPC.kidsCharacters, async (e): Promise<KidsCharacter[]> => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return listCharacters(join(cockpitHome(), 'kids'))
  })
  ipcMain.handle(IPC.dirsList, async (e): Promise<DirListing> => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return {
      dirs: await listDirs(config.get(), { claude: claudeHome(), codex: codexHome() }, tasks)
    }
  })
  ipcMain.handle(IPC.webRecent, (e): RecentPage[] => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return config.get().recentPages
  })
}

/**
 * Nothing in a renderer needs the network: cockpit.fetch runs here in main,
 * and links open in the browser. Sending the session through a proxy that
 * doesn't exist cuts off what CSP can't, such as WebRTC to a TURN server
 * (UDP is already off; see WidgetHost.attach). The dev server is on
 * localhost, so loopback stays direct in dev.
 */
async function cutRendererNetwork(): Promise<void> {
  const dev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
  await session.defaultSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: '127.0.0.1:9',
    proxyBypassRules: dev ? '' : '<-loopback>'
  })
}

/**
 * A web pane is a <webview> in the chrome. Whatever the chrome asked for, it
 * gets no preload and no Node, runs sandboxed, and browses in its own
 * partition: the default session's dead proxy and permission rules are the
 * chrome's, and its cookies stay apart from everything else.
 */
function hardenWebPane(prefs: WebPreferences, params: Record<string, string>): void {
  delete prefs.preload
  prefs.nodeIntegration = false
  prefs.nodeIntegrationInSubFrames = false
  prefs.contextIsolation = true
  prefs.sandbox = true
  prefs.webSecurity = true
  prefs.allowRunningInsecureContent = false
  params.partition = WEB_PARTITION
  delete params.allowpopups
}

/** Keep a web pane on web pages, and send popups and shortcuts where they belong. */
function guardWebPane(contents: WebContents): void {
  // New windows go to the browser, like links in the terminals.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const stay = (ev: { url: string; preventDefault: () => void }): void => {
    if (!isWebUrl(ev.url)) ev.preventDefault()
  }
  contents.on('will-navigate', stay)
  contents.on('will-redirect', stay)
  contents.on('will-frame-navigate', stay)
  // What the new-tab picker offers under Web. In-page navigations, such as a
  // slide deck's #hash, aren't new pages.
  contents.on('did-navigate', (_e, url) => {
    if (isWebUrl(url)) config.addRecentPage(url)
  })
  contents.on('page-title-updated', (_e, title, explicitSet) => {
    if (explicitSet) config.setRecentPageTitle(contents.getURL(), title)
  })
  // The page has the keyboard, so the chrome never sees its shortcuts. Pass
  // Cmd chords on, as WidgetHost does for widgets.
  contents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown' || !input.meta) return
    contents.hostWebContents?.send(IPC.appKey, {
      code: input.code,
      metaKey: input.meta,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift
    })
  })
}

/** Everything that needs the app to be ready. */
async function startup(): Promise<void> {
  // Unpackaged, the Dock shows Electron's icon until this runs.
  app.dock?.setIcon(iconPath)
  // Chrome needs no browser permissions; widgets get theirs through the broker.
  app.on('web-contents-created', (_e, contents) => {
    contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    contents.on('will-attach-webview', (ev, prefs, params) => {
      if (!windowFor(contents) || !isWebUrl(params.src ?? '')) {
        ev.preventDefault()
        return
      }
      hardenWebPane(prefs, params)
    })
    if (contents.getType() === 'webview') guardWebPane(contents)
  })
  // Permission checks (as opposed to requests) keep their default for the
  // chrome; widget frames are refused everything, devices included.
  session.defaultSession.setPermissionCheckHandler((_wc, _perm, _origin, details) => {
    return details.isMainFrame
  })
  session.defaultSession.setDevicePermissionHandler(() => false)
  await cutRendererNetwork()

  config = new ConfigStore((c) => {
    broadcast(IPC.configChanged, c)
    windowsChanged()
    appearanceChanged()
  })
  config.watch()

  themes = new ThemeStore(join(cockpitHome(), 'themes'), (list) => {
    broadcast(IPC.themesChanged, list)
    appearanceChanged()
  })
  themes.start()
  const imagesDir = join(cockpitHome(), 'images')
  images = new TreeWatcher(imagesDir, () => {
    imagesRevision++
    broadcast(IPC.imagesChanged, imagesRevision)
  })
  images.start()
  serveAssets({
    theme: (id) => themes.root(id),
    images: () => {
      try {
        return realpathSync(imagesDir)
      } catch {
        return null
      }
    }
  })

  widgets = new WidgetHost({
    home: cockpitHome(),
    trusted,
    theme: () => currentTheme().tokens,
    sessions: () => sessions().map(widgetSession),
    startSession: openSession,
    startTask: (draft) => openTaskDraft(draft),
    sendPrompt,
    runs: {
      submit: (widgetId, widgetName, graph) =>
        runs
          ? runs.submit(graph, { kind: 'widget', widgetId }, widgetName)
          : { ok: false, error: 'Cockpit is still starting' },
      markDone: (widgetId, runId, itemId) =>
        runs
          ? runs.markDoneFor(widgetId, runId, itemId)
          : Promise.resolve({ ok: false, error: 'No such run' }),
      list: (widgetId) => (runs?.listFor(widgetId) ?? []).map(toWidgetRun)
    },
    labelsChanged: sessionsChanged,
    changed: windowsChanged
  })
  widgets.start()

  tasks = new TaskStore({
    dir: join(cockpitHome(), 'worktrees'),
    settings: (repo) => config.get().tasks[repo],
    onChange: (list) => {
      broadcast(IPC.tasksChanged, list)
      runs?.poke()
    }
  })
  runs = new RunStore({
    dir: join(cockpitHome(), 'runs'),
    tasks: () => tasks.list(),
    scanned: () => tasks.lastScan > 0,
    create: (req) => tasks.create(req),
    mainCheckout: async (dir) => {
      const found = await mainCheckout(dir)
      return found.ok ? { ok: true, path: abbreviateHome(found.path) } : found
    },
    defaultBranch,
    agentIn,
    open: openRunItem,
    canStart: () => !kidsActive && terminalWindow() !== null,
    confirm: openRunDraft,
    readPr: async (url) => {
      const ref = prRefFromUrl(url)
      const res = ref ? await readPr(ref) : null
      return res?.ok ? res.pr.state : null
    },
    notify: runNotice,
    onChange: (list) => broadcast(IPC.runsChanged, list)
  })
  void tasks.refresh()
  tasksTimer = setInterval(() => {
    // A run left going with no window on screen still sees its merges.
    if (anyVisible() || runs?.needsPolling()) void tasks.refresh()
    void runs?.tick()
  }, TASKS_POLL_MS)
  branchesTimer = setInterval(() => {
    if (anyVisible()) refreshBranches()
  }, BRANCHES_POLL_MS)

  agents = new AgentMonitor({
    home: cockpitHome(),
    onChange: (paneId) => {
      sessionsChanged()
      void branches.refresh([paneId])
    },
    onActivity: (update) => broadcast(IPC.activityUpdate, update),
    runRequests: runRequests(runs),
    // No notifications over kids mode; the tab badges have them afterwards.
    windowFocused: () => kidsActive || anyFocused(),
    describe: (paneId) => {
      const pane = findPaneNode(paneId)
      if (!pane) return null
      const preset = config.get().presets.find((p) => p.id === pane.presetId)
      return { name: preset?.name ?? pane.presetId, place: basename(pane.cwd) || pane.cwd }
    },
    onClick: revealPane,
    onFailed: (error) => {
      // Without notifications, a bounce is the next best way to say so.
      app.dock?.bounce('informational')
      if (warnedNotifications) return
      warnedNotifications = true
      console.warn(
        `macOS refused a notification (${error}). Allow notifications for this app in ` +
          'System Settings > Notifications; an unsigned development build may not be allowed at all.'
      )
    }
  })
  try {
    await agents.start()
  } catch (err) {
    // Hooks can't report without the socket; the output heuristic still works.
    console.error('agent event server failed to start:', err)
  }

  applyMenu()
  registerIpc()
  for (const state of config.get().windows) createWindow(state)
  void startUpdates()

  // The Dock icon reopens the main window.
  app.on('activate', () => {
    const [main] = config.get().windows
    if (windows.length === 0 && main) createWindow(main)
  })

  // macOS moves windows off a display that goes away. Those moves aren't
  // saved, and the windows go back when the display returns.
  const displaysChanged = (): void => {
    displaysChangedAt = Date.now()
    windowsChanged()
    applyMenu()
  }
  screen.on('display-added', (_e, display) => {
    displaysChanged()
    // Give macOS a moment to finish arranging the displays first.
    setTimeout(() => returnToDisplay(display), DISPLAY_SETTLE_MS / 2)
  })
  screen.on('display-removed', displaysChanged)
  screen.on('display-metrics-changed', displaysChanged)
}

void app
  .whenReady()
  .then(startup)
  .catch((err: unknown) => {
    // Without config there is nothing to show; say why instead of idling windowless.
    console.error('Cockpit could not start:', err)
    dialog.showErrorBox('Cockpit could not start', err instanceof Error ? err.message : String(err))
    app.exit(1)
  })

app.on('window-all-closed', () => {
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Runs before windows close on the way out, so they're kept for the next
 * launch. An update's restart closes the windows before before-quit fires,
 * so it calls this first.
 */
function prepareToQuit(): void {
  quitting = true
  captureCwds()
  ptys.killAll()
}

app.on('before-quit', prepareToQuit)

app.on('will-quit', () => {
  if (tasksTimer) clearInterval(tasksTimer)
  if (branchesTimer) clearInterval(branchesTimer)
  // A startup that failed partway leaves some of these unset.
  const parts = [config, themes, images, system, widgets, agents, updates] as (
    { close: () => void } | undefined
  )[]
  for (const part of parts) part?.close()
})
