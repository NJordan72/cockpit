import { describe, expect, it } from 'bun:test'
import { cpuShare, memoryUsed, parseVmStat } from './system'

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   147276.
Pages active:                                1056562.
Pages wired down:                             369909.
Pages purgeable:                                6351.
"Translation faults":                     1268885005.
Anonymous pages:                             1394967.
Pages occupied by compressor:                 470799.
`

describe('vm_stat', () => {
  it('reads the page size and counts', () => {
    const vm = parseVmStat(VM_STAT)
    expect(vm?.pageSize).toBe(16384)
    expect(vm?.pages['Pages wired down']).toBe(369909)
    expect(vm?.pages['Translation faults']).toBe(1268885005)
  })

  it('counts used memory as app memory, wired, and compressed', () => {
    const vm = parseVmStat(VM_STAT)
    expect(vm && memoryUsed(vm)).toBe((1394967 - 6351 + 369909 + 470799) * 16384)
  })

  it('gives up on output it does not recognize', () => {
    expect(parseVmStat('nope')).toBeNull()
    const vm = parseVmStat('Mach Virtual Memory Statistics: (page size of 4096 bytes)\n')
    expect(vm && memoryUsed(vm)).toBeNull()
  })
})

describe('cpuShare', () => {
  it('is the busy share of the time between two readings', () => {
    expect(cpuShare({ busy: 100, total: 1000 }, { busy: 350, total: 2000 })).toBe(0.25)
    expect(cpuShare({ busy: 1, total: 1 }, { busy: 1, total: 1 })).toBe(0)
  })
})
