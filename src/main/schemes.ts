import { protocol } from 'electron'
import { ASSET_SCHEME } from '@shared/assets'
import { WIDGET_SCHEME } from '@shared/widgets'

/**
 * Must run before the app is ready, and only once: Electron keeps only the
 * last call's list.
 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WIDGET_SCHEME,
      // standard: host is the widget id and relative URLs resolve. secure:
      // widgets get a secure context. corsEnabled: module scripts load.
      privileges: { standard: true, secure: true, corsEnabled: true }
    },
    {
      scheme: ASSET_SCHEME,
      // standard: a theme stylesheet's relative url()s resolve inside its
      // folder. corsEnabled: fonts load in CORS mode.
      privileges: { standard: true, secure: true, corsEnabled: true }
    }
  ])
}
