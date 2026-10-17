import type { WidgetError, WidgetErrorCode } from '@shared/widgets'

/** An error the widget sees as a CockpitError with this code and message. */
export class WidgetCallError extends Error {
  constructor(
    readonly code: WidgetErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WidgetCallError'
  }
}

export function toWidgetError(err: unknown): WidgetError {
  if (err instanceof WidgetCallError) return { code: err.code, message: err.message }
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) }
}
