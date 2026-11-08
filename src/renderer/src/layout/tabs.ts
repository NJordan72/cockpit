// Which tabs the tab bar shows. The bar can leave out the tabs of chosen
// project folders; pinned tabs and the active tab always show.
import type { Layout, Tab } from '@shared/config'
import { allPanes } from './model'

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** The repository of the task a directory is in, or null outside one. */
export type RepoOf = (cwd: string) => string | null

const noTasks: RepoOf = () => null

/**
 * The project folder a directory is in: the folder right under the projects
 * directory that holds it (`~/dev/cockpit` for `~/dev/cockpit/src`), or the
 * directory itself when it's outside the projects directory. A task's
 * worktree is in its repository's folder.
 */
export function projectDir(cwd: string, projectsDir: string, repoOf: RepoOf = noTasks): string {
  const dir = trimSlash(repoOf(cwd) ?? cwd)
  const root = trimSlash(projectsDir)
  if (!dir.startsWith(`${root}/`)) return dir
  const first = dir.slice(root.length + 1).split('/')[0]
  return first ? `${root}/${first}` : dir
}

/** The project folders a tab's panes started in, once each. */
export function tabDirs(tab: Tab, projectsDir: string, repoOf: RepoOf = noTasks): string[] {
  return [...new Set(allPanes(tab.root).map((p) => projectDir(p.cwd, projectsDir, repoOf)))]
}

/** True when the tab isn't pinned and every pane in it is in a hidden folder. */
export function folderHidden(
  tab: Tab,
  hiddenDirs: readonly string[],
  projectsDir: string,
  repoOf: RepoOf = noTasks
): boolean {
  if (tab.pinned || hiddenDirs.length === 0) return false
  return tabDirs(tab, projectsDir, repoOf).every((d) => hiddenDirs.includes(d))
}

/** The tabs the bar shows: the ones the filter doesn't hide, and the active one. */
export function shownTabs(
  layout: Layout,
  hiddenDirs: readonly string[],
  projectsDir: string,
  repoOf: RepoOf = noTasks
): Tab[] {
  if (hiddenDirs.length === 0) return layout.tabs
  return layout.tabs.filter(
    (t) => t.id === layout.activeTabId || !folderHidden(t, hiddenDirs, projectsDir, repoOf)
  )
}

export interface TabFolder {
  dir: string
  /** How many of the tabs the filter applies to (not pinned) have a pane there. */
  tabs: number
}

/** The folders the filter can hide, sorted by path. */
export function tabFolders(
  layout: Layout,
  projectsDir: string,
  repoOf: RepoOf = noTasks
): TabFolder[] {
  const counts = new Map<string, number>()
  for (const t of layout.tabs) {
    if (t.pinned) continue
    for (const d of tabDirs(t, projectsDir, repoOf)) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return [...counts]
    .map(([dir, tabs]) => ({ dir, tabs }))
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
}

/**
 * The index `moveTab` takes for a tab dropped at position `to` among `group`,
 * the tab ids the bar shows in the dragged tab's group (pinned or not). It
 * lands next to the shown tab it was dropped by; hidden tabs keep their places.
 */
export function dropIndex(
  tabs: readonly Tab[],
  group: readonly string[],
  tabId: string,
  to: number
): number {
  const rest = tabs.filter((t) => t.id !== tabId).map((t) => t.id)
  const others = group.filter((id) => id !== tabId)
  const before = others[to]
  if (before !== undefined) return rest.indexOf(before)
  const last = others[others.length - 1]
  return last === undefined ? rest.length : rest.indexOf(last) + 1
}
