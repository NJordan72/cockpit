import { describe, expect, it } from 'bun:test'
import type { Layout, LayoutNode, PaneNode, Tab } from '@shared/config'
import { dropIndex, folderHidden, projectDir, shownTabs, tabDirs, tabFolders } from './tabs'

const pane = (id: string, cwd: string): PaneNode => ({ type: 'pane', id, presetId: 'shell', cwd })
const tab = (id: string, root: LayoutNode, extra: Partial<Tab> = {}): Tab => ({
  id,
  root,
  activePaneId: root.type === 'pane' ? root.id : '',
  ...extra
})
const split = (...children: PaneNode[]): LayoutNode => ({
  type: 'split',
  id: 'split',
  direction: 'row',
  children,
  sizes: children.map(() => 1 / children.length)
})

describe('projectDir', () => {
  it('is the folder right under the projects directory', () => {
    expect(projectDir('~/dev/cockpit', '~/dev')).toBe('~/dev/cockpit')
    expect(projectDir('~/dev/cockpit/src/main', '~/dev')).toBe('~/dev/cockpit')
    expect(projectDir('~/dev/cockpit/', '~/dev/')).toBe('~/dev/cockpit')
  })

  it('is the directory itself outside the projects directory', () => {
    expect(projectDir('~', '~/dev')).toBe('~')
    expect(projectDir('~/dev', '~/dev')).toBe('~/dev')
    expect(projectDir('~/devtools/x', '~/dev')).toBe('~/devtools/x')
    expect(projectDir('/tmp/', '~/dev')).toBe('/tmp')
  })
})

describe('task worktrees', () => {
  it("are in their repository's folder", () => {
    const repoOf = (cwd: string): string | null =>
      cwd.startsWith('~/.cockpit/worktrees/app/') ? '~/dev/app' : null
    expect(projectDir('~/.cockpit/worktrees/app/feat-x/src', '~/dev', repoOf)).toBe('~/dev/app')
    const layout: Layout = {
      tabs: [
        tab('main', pane('m', '~/dev/app')),
        tab('task', pane('t', '~/.cockpit/worktrees/app/feat-x')),
        tab('other', pane('o', '~/dev/other'))
      ],
      activeTabId: 'other'
    }
    expect(tabFolders(layout, '~/dev', repoOf)).toEqual([
      { dir: '~/dev/app', tabs: 2 },
      { dir: '~/dev/other', tabs: 1 }
    ])
    expect(shownTabs(layout, ['~/dev/app'], '~/dev', repoOf).map((t) => t.id)).toEqual(['other'])
  })
})

describe('tabDirs', () => {
  it('lists each pane folder once', () => {
    const t = tab('t', split(pane('a', '~/dev/a'), pane('b', '~/dev/a/src'), pane('c', '~')))
    expect(tabDirs(t, '~/dev')).toEqual(['~/dev/a', '~'])
  })
})

describe('shownTabs', () => {
  const first = tab('a', pane('a', '~/dev/a'))
  const pinned = tab('pinned', pane('p', '~/dev/b'), { pinned: true })
  const layout: Layout = {
    tabs: [
      first,
      tab('b', pane('b', '~/dev/b')),
      tab('mixed', split(pane('m1', '~/dev/b'), pane('m2', '~/dev/a'))),
      tab('b2', pane('b2', '~/dev/b/web')),
      pinned
    ],
    activeTabId: 'a'
  }

  it('shows every tab with nothing hidden', () => {
    expect(shownTabs(layout, [], '~/dev')).toBe(layout.tabs)
  })

  it('leaves out tabs whose panes are all in hidden folders, but not pinned ones', () => {
    expect(shownTabs(layout, ['~/dev/b'], '~/dev').map((t) => t.id)).toEqual([
      'a',
      'mixed',
      'pinned'
    ])
    expect(folderHidden(pinned, ['~/dev/b'], '~/dev')).toBe(false)
  })

  it('keeps the active tab even when its folder is hidden', () => {
    expect(shownTabs(layout, ['~/dev/a', '~/dev/b'], '~/dev').map((t) => t.id)).toEqual([
      'a',
      'pinned'
    ])
    expect(folderHidden(first, ['~/dev/a'], '~/dev')).toBe(true)
  })
})

describe('tabFolders', () => {
  it('counts the tabs in each folder, sorted, leaving out pinned tabs', () => {
    const layout: Layout = {
      tabs: [
        tab('b', pane('b', '~/dev/b')),
        tab('mixed', split(pane('m1', '~/dev/b/x'), pane('m2', '~/dev/a'))),
        tab('only-pinned', pane('p', '~/dev/c'), { pinned: true })
      ],
      activeTabId: 'b'
    }
    expect(tabFolders(layout, '~/dev')).toEqual([
      { dir: '~/dev/a', tabs: 1 },
      { dir: '~/dev/b', tabs: 2 }
    ])
  })
})

describe('dropIndex', () => {
  const ids = (...xs: string[]): Tab[] => xs.map((x) => tab(x, pane(x, '~')))

  it('is the plain position when every tab shows', () => {
    const tabs = ids('a', 'b', 'c')
    expect(dropIndex(tabs, ['a', 'b', 'c'], 'a', 2)).toBe(2)
    expect(dropIndex(tabs, ['a', 'b', 'c'], 'c', 0)).toBe(0)
  })

  it('lands next to the shown tab it was dropped by, past hidden ones', () => {
    // h is hidden between b and c; a dropped between b and c goes before c.
    const tabs = ids('a', 'b', 'h', 'c')
    expect(dropIndex(tabs, ['a', 'b', 'c'], 'a', 1)).toBe(2)
    // Dropped at the end, it goes right after c.
    expect(dropIndex(tabs, ['a', 'b', 'c'], 'a', 2)).toBe(3)
  })

  it('works within the pinned group', () => {
    const tabs = ids('a', 'b', 'p1', 'p2')
    expect(dropIndex(tabs, ['p1', 'p2'], 'p2', 0)).toBe(2)
    expect(dropIndex(tabs, ['p1', 'p2'], 'p1', 1)).toBe(3)
  })
})
