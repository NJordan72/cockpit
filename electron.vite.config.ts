import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { transformWithOxc, type Plugin } from 'vite'

// The chrome's CSP. Dev needs inline scripts (React refresh preamble) and the
// Vite websocket; the built app gets the strict policy.
function cspPlugin(): Plugin {
  const strict = [
    "default-src 'none'",
    "script-src 'self'",
    // xterm.js injects <style> elements at runtime.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    'frame-src cockpit-widget:',
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'"
  ]
  return {
    name: 'cockpit-csp',
    transformIndexHtml(html, ctx) {
      const policy = ctx.server
        ? strict.map((d) =>
            d.startsWith('script-src')
              ? "script-src 'self' 'unsafe-inline'"
              : d.startsWith('connect-src')
                ? "connect-src 'self' ws://localhost:* http://localhost:*"
                : d
          )
        : strict
      return html.replace('%COCKPIT_CSP%', policy.join('; '))
    }
  }
}

// The SDK runs inside widgets as a classic <script>, not as part of any of
// the app's bundles. Compile it on its own and hand it to the main process as
// a string, which serves it at cockpit-widget://<id>/cockpit-widget.js.
function widgetSdkPlugin(): Plugin {
  const id = 'virtual:cockpit-widget-sdk'
  const resolvedId = '\0' + id
  const file = resolve(__dirname, 'src/widget-sdk/cockpit-widget.ts')
  return {
    name: 'cockpit-widget-sdk',
    resolveId: (source) => (source === id ? resolvedId : undefined),
    async load(loadId) {
      if (loadId !== resolvedId) return
      this.addWatchFile(file)
      const result = await transformWithOxc(await readFile(file, 'utf8'), file, {
        lang: 'ts',
        target: 'es2022'
      })
      // Type-only imports leave an `export {}` behind, which a classic
      // script can't parse.
      const code = result.code.replace(/^export \{\};?\s*$/m, '')
      if (/^\s*(import|export)\b/m.test(code)) {
        this.error('the widget SDK must not import or export values; it runs as a classic script')
      }
      return `export default ${JSON.stringify(code)}`
    }
  }
}

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    plugins: [widgetSdkPlugin()]
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: shared },
    plugins: [react(), cspPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
