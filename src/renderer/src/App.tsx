import { TerminalPane } from './terminal/TerminalPane'

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <div className="titlebar" />
      <main className="workspace">
        <TerminalPane id="main" />
      </main>
    </div>
  )
}
