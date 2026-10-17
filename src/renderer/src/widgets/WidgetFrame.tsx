import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WIDGET_SCHEME, type WidgetManifest } from '@shared/widgets'
import { registerFrame, setFrameVisible, type FrameHandle } from './host'

interface Props {
  id: string
  manifest: WidgetManifest
  visible: boolean
}

const MIN_CONTENT_HEIGHT = 24
const MAX_CONTENT_HEIGHT = 2000

/**
 * One widget, sandboxed: scripts only, no allow-same-origin, so it gets an
 * opaque origin and can't reach the chrome's DOM or storage. Its parent
 * remounts it (by key) to reload it.
 */
export function WidgetFrame({ id, manifest, visible }: Props): React.JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null)
  const handleRef = useRef<FrameHandle | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const initial = useRef({ manifest, visible })

  // Register before the widget's script can say hello.
  useLayoutEffect(() => {
    const win = ref.current?.contentWindow
    if (!win) return
    const handle: FrameHandle = {
      win,
      ...initial.current,
      onSize: (h) => {
        setHeight(Math.min(MAX_CONTENT_HEIGHT, Math.max(MIN_CONTENT_HEIGHT, Math.ceil(h))))
      }
    }
    handleRef.current = handle
    const unregister = registerFrame(id, handle)
    return () => {
      unregister()
      handleRef.current = null
    }
  }, [id])

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    handle.manifest = manifest
    setFrameVisible(handle, visible)
  }, [manifest, visible])

  return (
    <iframe
      ref={ref}
      className="widget-frame"
      title={manifest.name}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={`${WIDGET_SCHEME}://${id}/${manifest.entry}`}
      style={manifest.sizing === 'content' ? { height: height ?? 80 } : undefined}
    />
  )
}
