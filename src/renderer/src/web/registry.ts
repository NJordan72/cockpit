/** Live web panes by pane id, so the chrome can give one the keyboard or reload it. */
export const webPanes = new Map<string, { focus: () => void; reload: () => void }>()
