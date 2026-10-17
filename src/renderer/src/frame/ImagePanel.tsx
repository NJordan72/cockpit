import { useState } from 'react'
import { imageUrl, themeAssetUrl } from '@shared/assets'
import type { FramePanel } from '@shared/frame'

interface Props {
  panel: FramePanel
  /** The theme in use, for theme:<file> sources. */
  themeId: string
  /** Goes up when anything in ~/.cockpit/images/ changes. */
  revision: number
}

/** A picture or an animated GIF from ~/.cockpit/images/ or the theme's folder. */
export function ImagePanel({ panel, themeId, revision }: Props): React.JSX.Element {
  const src = panel.src ?? 'banner'
  const fromTheme = src.startsWith('theme:')
  const url = fromTheme
    ? themeAssetUrl(themeId, src.slice('theme:'.length), revision)
    : imageUrl(src, revision)
  const [failed, setFailed] = useState<string | null>(null)

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
