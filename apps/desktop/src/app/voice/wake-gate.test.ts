import { describe, expect, it } from 'vitest'

import { WakeGate } from './wake-gate'

function frame(amplitude: number, samples = 1_600): Int16Array {
  return new Int16Array(samples).fill(amplitude)
}

describe('WakeGate', () => {
  it('rejects a single high-confidence chime spike', () => {
    let now = 0
    const gate = new WakeGate({ now: () => now })

    gate.updateAudio(frame(2_000))

    expect(gate.acceptsWakeScore()).toBe(false)

    now += 100
    gate.updateAudio(frame(0))

    expect(gate.acceptsWakeScore()).toBe(false)
  })

  it('accepts repeated high-confidence scores after sustained speech-like audio', () => {
    let now = 0
    const gate = new WakeGate({ now: () => now })

    for (let index = 0; index < 5; index += 1) {
      gate.updateAudio(frame(800))
      now += 100
    }

    expect(gate.acceptsWakeScore()).toBe(false)

    now += 240

    expect(gate.acceptsWakeScore()).toBe(true)
  })

  it('expires separated wake hits', () => {
    let now = 0
    const gate = new WakeGate({ now: () => now })

    for (let index = 0; index < 5; index += 1) {
      gate.updateAudio(frame(800))
    }

    expect(gate.acceptsWakeScore()).toBe(false)

    now += 1_000

    expect(gate.acceptsWakeScore()).toBe(false)
  })
})
