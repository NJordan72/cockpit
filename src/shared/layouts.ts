// Layouts that ship with Cockpit. config.json keeps a copy of a layout once
// it's been changed (a divider dragged, a panel folded); View > Layout > Reset
// Layout deletes the copy.
import type { AppearanceSettings, SidebarSettings } from './config'
import { panel, readFrame, type FrameNode, type FrameSplit, type FrameTabs } from './frame'

export interface BuiltInLayout {
  id: string
  name: string
  tree: FrameNode
}

const widgetsGroup = (): FrameSplit => ({
  type: 'split',
  id: 'widgets',
  direction: 'column',
  title: 'Widgets',
  widgets: 'rest',
  children: []
})

/** Tab bar across the top, terminals, and a sidebar on the right. */
const classic: FrameNode = {
  type: 'split',
  id: 'root',
  direction: 'column',
  children: [
    panel('tabbar'),
    {
      type: 'split',
      id: 'main',
      direction: 'row',
      children: [
        panel('workspace'),
        {
          type: 'split',
          id: 'sidebar',
          direction: 'column',
          size: 320,
          children: [
            panel('sessions', { max: 0.45 }),
            panel('activity', { size: 320, tab: 'log' }),
            widgetsGroup()
          ]
        }
      ]
    }
  ]
}

/**
 * An image banner and a clock across the top, Activity on the left, and the
 * sessions, the system monitor, and widgets on the right.
 */
const cockpit: FrameNode = {
  type: 'split',
  id: 'root',
  direction: 'column',
  children: [
    {
      type: 'split',
      id: 'banner',
      direction: 'row',
      size: 180,
      children: [panel('image', { src: 'banner', flex: 3 }), panel('clock', { flex: 1 })]
    },
    panel('tabbar'),
    {
      type: 'split',
      id: 'main',
      direction: 'row',
      children: [
        panel('activity', { size: 300, tab: 'log' }),
        panel('workspace'),
        {
          type: 'split',
          id: 'sidebar',
          direction: 'column',
          size: 340,
          children: [panel('sessions', { max: 0.4 }), panel('monitor'), widgetsGroup()]
        }
      ]
    }
  ]
}

export const DEFAULT_LAYOUT_ID = 'classic'

export const BUILT_IN_LAYOUTS: readonly BuiltInLayout[] = [
  { id: 'classic', name: 'Classic', tree: classic },
  { id: 'cockpit', name: 'Cockpit', tree: cockpit }
]

export function builtInLayout(id: string): FrameNode | null {
  return BUILT_IN_LAYOUTS.find((l) => l.id === id)?.tree ?? null
}

/** Version 2's sidebar settings as the classic layout, so an upgrade looks the same. */
export function classicFromSidebar(sb: SidebarSettings): FrameNode {
  const widgets = sb.widgets.map((w) =>
    panel('widget', {
      widget: w.id,
      flex: w.size,
      ...(w.collapsed ? { collapsed: true } : {})
    })
  )
  const group: FrameSplit | FrameTabs =
    sb.mode === 'tabs'
      ? {
          type: 'tabs',
          id: 'widgets',
          title: 'Widgets',
          widgets: 'rest',
          active: sb.activeWidget ? `widget:${sb.activeWidget}` : (widgets[0]?.id ?? null),
          children: widgets
        }
      : { ...widgetsGroup(), children: widgets }
  return readFrame({
    type: 'split',
    id: 'root',
    direction: 'column',
    children: [
      panel('tabbar'),
      {
        type: 'split',
        id: 'main',
        direction: 'row',
        children: [
          panel('workspace'),
          {
            type: 'split',
            id: 'sidebar',
            direction: 'column',
            size: sb.width,
            children: [
              panel('sessions', {
                max: 0.45,
                ...(sb.sessionsCollapsed ? { collapsed: true } : {})
              }),
              panel('activity', {
                size: sb.activity.height,
                tab: sb.activity.tab,
                ...(sb.activity.collapsed ? { collapsed: true } : {})
              }),
              group
            ]
          }
        ]
      }
    ]
  })
}

/** Built-in layouts, then ones only config.json has. */
export function layoutChoices(appearance: AppearanceSettings): { id: string; name: string }[] {
  const builtIn = BUILT_IN_LAYOUTS.map((l) => ({ id: l.id, name: l.name }))
  const mine = Object.keys(appearance.layouts)
    .filter((id) => !BUILT_IN_LAYOUTS.some((l) => l.id === id))
    .map((id) => ({ id, name: id }))
  return [...builtIn, ...mine]
}
