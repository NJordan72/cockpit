import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { loadFonts } from './fonts/load'
import { trimCanvasFonts } from './terminal/canvasFont'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
trimCanvasFonts()
await loadFonts()
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
