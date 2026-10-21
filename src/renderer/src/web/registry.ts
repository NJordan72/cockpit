/** Live web panes by pane id, so the chrome can give one the keyboard. */
export const webPanes = new Map<string, { focus: () => void }>()
