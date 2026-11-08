import type { PaneLabel } from '@shared/widgets'

interface Props {
  paneId: string
  labels: readonly PaneLabel[]
}

/** The hover text: everything on the line, the widget's detail, and where it came from. */
function tooltip(label: PaneLabel): string {
  return [
    `${label.key} ${label.title}`,
    label.facts.join(' · '),
    label.detail,
    label.url ? `${label.widgetName}: click to open in the browser` : label.widgetName
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * What widgets say about the pane, one line per widget, above its terminal.
 * Everything a widget sent is drawn as text.
 */
export function LabelStrip({ paneId, labels }: Props): React.JSX.Element {
  return (
    <div className="label-strip">
      {labels.map((label) => {
        const content = (
          <>
            <span className="label-key">{label.key}</span>
            <span className="label-title">{label.title}</span>
            {label.facts.map((fact, i) => (
              <span key={i} className="label-fact">
                {fact}
              </span>
            ))}
          </>
        )
        return label.url ? (
          <button
            key={label.widgetId}
            type="button"
            tabIndex={-1}
            className="label-row"
            title={tooltip(label)}
            // Keep the keyboard in the terminal.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => window.cockpit.widgets.openLabel(paneId, label.widgetId)}
          >
            {content}
          </button>
        ) : (
          <div key={label.widgetId} className="label-row" title={tooltip(label)}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
