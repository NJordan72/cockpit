/** Follow a pointer drag from `e`, reporting how far it has moved from where it started. */
export function dragPointer(
  e: React.PointerEvent<HTMLElement>,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void
): void {
  e.preventDefault()
  const target = e.currentTarget
  target.setPointerCapture(e.pointerId)
  const x0 = e.clientX
  const y0 = e.clientY
  const move = (ev: PointerEvent): void => {
    onMove(ev.clientX - x0, ev.clientY - y0)
  }
  const up = (): void => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', up)
    onEnd?.()
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)
}
