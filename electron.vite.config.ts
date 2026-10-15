import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

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

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
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
