import { beforeEach, describe, expect, it } from 'vitest'
import { PTY_ACK_CHARS } from '@shared/ipc'
import { OutputAcks } from './acks'

let acked: number[]
let acks: OutputAcks

beforeEach(() => {
  acked = []
  acks = new OutputAcks((n) => acked.push(n))
})

const sum = (): number => acked.reduce((a, b) => a + b, 0)

describe('OutputAcks', () => {
  it('acknowledges parsed output in steps', () => {
    const half = PTY_ACK_CHARS / 2
    const a = acks.received(half, false)
    const b = acks.received(half, false)
    a?.()
    expect(acked).toEqual([])
    b?.()
    expect(acked).toEqual([PTY_ACK_CHARS])
  })

  it('counts hidden output as done when it arrives', () => {
    expect(acks.received(PTY_ACK_CHARS, true)).toBeNull()
    expect(acked).toEqual([PTY_ACK_CHARS])
  })

  it('lets everything go when the window is hidden, without counting it twice', () => {
    const parsed = acks.received(PTY_ACK_CHARS * 3, false)
    acks.releaseAll()
    expect(sum()).toBe(PTY_ACK_CHARS * 3)
    parsed?.()
    expect(sum()).toBe(PTY_ACK_CHARS * 3)
    acks.received(PTY_ACK_CHARS, false)?.()
    expect(sum()).toBe(PTY_ACK_CHARS * 4)
  })

  it('releases parsed output still short of a step', () => {
    acks.received(10, false)?.()
    acks.releaseAll()
    expect(acked).toEqual([10])
  })
})
