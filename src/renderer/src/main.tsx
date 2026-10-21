import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { loadFonts } from './fonts/load'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
await loadFonts()
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
