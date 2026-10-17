// The chrome's end of the widget postMessage protocol. Each widget iframe
// registers its window here. A message is attributed to a widget by the
// window it came from (event.source), never by anything inside the message,
// so a widget can't act as another one. Calls go on to the main process,
// which checks them against the widget's manifest.
import {
  WIDGET_METHODS,
  type HostToWidget,
  type WidgetInit,
  type WidgetManifest,
  type WidgetMethod
} from '@shared/widgets'

export interface FrameHandle {
  readonly win: Window
  manifest: WidgetManifest
  visible: boolean
  /** sizing "content": the widget reported its document height. */
  onSize: (height: number) => void
}

const frames = new Map<string, FrameHandle>()
let theme: Record<string, string> = {}

function post(win: Window, msg: HostToWidget): void {
  // Widgets have opaque origins, so there is no origin to target. The window
  // can only hold this widget's document: main refuses navigations away.
  win.postMessage(msg, '*')
}

function initFor(id: string, f: FrameHandle): WidgetInit {
  const m = f.manifest
  return {
    widget: { id, name: m.name, version: m.version, sizing: m.sizing },
    permissions: m.permissions,
    theme,
    visible: f.visible
  }
}

function entryFor(source: MessageEventSource | null): [string, FrameHandle] | null {
  for (const entry of frames) if (entry[1].win === source) return entry
  return null
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function onMessage(e: MessageEvent): void {
  const entry = entryFor(e.source)
  if (!entry) return
  const [id, frame] = entry
  const msg: unknown = e.data
  if (!isObj(msg) || msg.cockpit !== 1) return
  switch (msg.type) {
    case 'hello':
      post(frame.win, { cockpit: 1, type: 'init', init: initFor(id, frame) })
      return
    case 'call': {
      const callId = msg.id
      if (typeof callId !== 'number') return
      const win = frame.win
      if (typeof msg.method !== 'string' || !WIDGET_METHODS.includes(msg.method as WidgetMethod)) {
        post(win, {
          cockpit: 1,
          type: 'result',
          id: callId,
          result: {
            ok: false,
            error: { code: 'invalid_argument', message: `unknown method ${String(msg.method)}` }
          }
        })
        return
      }
      void window.cockpit.widgets
        .call(id, msg.method as WidgetMethod, msg.params)
        .catch((err: unknown) => ({
          ok: false as const,
          error: { code: 'internal' as const, message: String(err) }
        }))
        .then((result) => {
          post(win, { cockpit: 1, type: 'result', id: callId, result })
        })
      return
    }
    case 'size':
      if (frame.manifest.sizing === 'content' && typeof msg.height === 'number') {
        frame.onSize(msg.height)
      }
      return
  }
}

let started = false

/** Install the message listener and the main-process event relay once. */
export function startWidgetHost(): void {
  if (started) return
  started = true
  window.addEventListener('message', onMessage)
  window.cockpit.widgets.onEvent((id, topic, data) => {
    const f = frames.get(id)
    if (f) post(f.win, { cockpit: 1, type: 'event', topic, data })
  })
}

/** Register a widget's iframe window. Returns the unregister function. */
export function registerFrame(id: string, handle: FrameHandle): () => void {
  frames.set(id, handle)
  return () => {
    if (frames.get(id) === handle) frames.delete(id)
  }
}

export function setFrameVisible(handle: FrameHandle, visible: boolean): void {
  if (handle.visible === visible) return
  handle.visible = visible
  post(handle.win, { cockpit: 1, type: 'event', topic: 'visibility', data: { visible } })
}

export function setWidgetTheme(vars: Record<string, string>): void {
  if (JSON.stringify(vars) === JSON.stringify(theme)) return
  theme = vars
  for (const f of frames.values())
    post(f.win, { cockpit: 1, type: 'event', topic: 'theme', data: vars })
}

declare global {
  interface Window {
    __cockpitWidgets?: () => { id: string; visible: boolean }[]
  }
}

window.__cockpitWidgets = () => [...frames].map(([id, f]) => ({ id, visible: f.visible }))
