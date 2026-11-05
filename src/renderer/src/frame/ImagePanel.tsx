import { useState } from 'react'
import { imageUrl, themeAssetUrl } from '@shared/assets'
import type { FramePanel } from '@shared/frame'
import type { PaneSession } from '@shared/ipc'
import { Hud } from './Hud'

interface Props {
  panel: FramePanel
  /** The theme in use, for theme:<file> sources. */
  themeId: string
  /** Goes up when anything in ~/.cockpit/images/ changes. */
  revision: number
  /** For the built-in banner's traffic. */
  sessions: readonly PaneSession[]
  visible: boolean
}

/** The source that is the built-in banner, rather than a file. */
export const BUILTIN_HUD = 'builtin:hud'
/** The source a panel without one uses. With no such file, it shows the built-in banner. */
const DEFAULT_SRC = 'banner'

/**
 * A picture or an animated GIF from ~/.cockpit/images/ or the theme's folder,
 * or the built-in head-up display.
 */
export function ImagePanel({
  panel,
  themeId,
  revision,
  sessions,
  visible
}: Props): React.JSX.Element {
  const src = panel.src ?? DEFAULT_SRC
  const fromTheme = src.startsWith('theme:')
  const url = fromTheme
    ? themeAssetUrl(themeId, src.slice('theme:'.length), revision)
    : imageUrl(src, revision)
  const [failed, setFailed] = useState<string | null>(null)

  if (src === BUILTIN_HUD || (src === DEFAULT_SRC && failed === url)) {
    return <Hud sessions={sessions} visible={visible} />
  }
  if (failed === url) {
    return (
      <div className="image-missing">
        {fromTheme ? (
          <>
            The theme has no <code>{src.slice('theme:'.length)}</code>.
          </>
        ) : (
          <span>
            Put an image or GIF at <code>~/.cockpit/images/{src}</code>
            {src.includes('.') ? '' : ' (.gif, .png, .jpg, or .webp)'}.
          </span>
        )}
      </div>
    )
  }
  return (
    <img
      className="image-panel"
      src={url}
      alt=""
      draggable={false}
      style={{
        objectFit: panel.fit ?? 'cover',
        objectPosition: panel.position ?? 'center',
        imageRendering: panel.pixelated ? 'pixelated' : undefined
      }}
      onError={() => setFailed(url)}
    />
  )
}
