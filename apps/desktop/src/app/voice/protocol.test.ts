import { describe, expect, it } from 'vitest'

import {
  FLAG_LAST,
  floatToPcm16,
  HEADER_BYTES,
  KIND_MIC,
  KIND_TTS,
  packFrame,
  parseFrame,
  pcm16ToFloat
} from './protocol'

describe('voice protocol OVX1 framing', () => {
  it('round-trips a mic frame', () => {
    const pcm = new Int16Array([0, 100, -100, 32_767, -32_768])
    const frame = parseFrame(packFrame(KIND_MIC, 0, 3, 42, pcm))

    expect(frame).not.toBeNull()
    expect(frame?.kind).toBe(KIND_MIC)
    expect(frame?.flags).toBe(0)
    expect(frame?.epoch).toBe(3)
    expect(frame?.seq).toBe(42)
    expect([...(frame?.pcm ?? [])]).toEqual([...pcm])
  })

  it('round-trips a last-chunk TTS frame with empty payload', () => {
    const frame = parseFrame(packFrame(KIND_TTS, FLAG_LAST, 7, 19, new Int16Array(0)))

    expect(frame?.kind).toBe(KIND_TTS)
    expect((frame?.flags ?? 0) & FLAG_LAST).toBe(FLAG_LAST)
    expect(frame?.pcm.length).toBe(0)
  })

  it('rejects buffers without the OVX1 magic or too short', () => {
    expect(parseFrame(new ArrayBuffer(HEADER_BYTES - 1))).toBeNull()

    const bogus = new ArrayBuffer(HEADER_BYTES)
    new DataView(bogus).setUint32(0, 0xde_ad_be_ef, true)
    expect(parseFrame(bogus)).toBeNull()
  })

  it('drops a ragged tail byte instead of corrupting the sample view', () => {
    const packed = packFrame(KIND_TTS, 0, 0, 0, new Int16Array([1, 2, 3]))
    const ragged = new Uint8Array(packed.byteLength + 1)
    ragged.set(new Uint8Array(packed))

    const frame = parseFrame(ragged.buffer)

    expect(frame?.pcm.length).toBe(3)
  })

  it('converts float to PCM16 with clipping and back', () => {
    const pcm = floatToPcm16(new Float32Array([0, 0.5, -0.5, 2, -2]))

    expect(pcm[0]).toBe(0)
    expect(pcm[3]).toBe(32_767)
    expect(pcm[4]).toBe(-32_768)

    const floats = pcm16ToFloat(pcm)

    expect(floats[1]).toBeCloseTo(0.5, 2)
    expect(floats[4]).toBeCloseTo(-1, 2)
  })
})
