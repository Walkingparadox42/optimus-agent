/**
 * [Optimus Cockpit] Voice session wire protocol (:9125) — Phase 4 P1D-1.
 *
 * Client-side codec for docs/cockpit-reference/voice-protocol.md:
 * JSON control/event messages plus OVX1 binary PCM frames (section 1.1,
 * FIRM 2026-07-06). PCM is 16-bit signed mono @ 16 kHz — the single
 * internal rate; both ends resample only at their own edges.
 */

export const VOICE_RATE = 16_000
export const HEADER_BYTES = 16
export const FRAME_SAMPLES = 1_600 // 100 ms per mic frame

const MAGIC = 0x31_58_56_4f // 'OVX1' little-endian

export const KIND_MIC = 1
export const KIND_TTS = 2
export const FLAG_LAST = 0x01

export interface BinaryFrame {
  epoch: number
  flags: number
  kind: number
  pcm: Int16Array
  seq: number
}

/** Four-ID envelope every server message carries (spec section 2; run_id
 *  stands in for response_id per ADR-0014). */
export interface ServerMessage {
  generation_epoch: number
  message: string
  run_id: null | string
  session_id: null | string
  turn_id: null | string
  [key: string]: unknown
}

export function packFrame(kind: number, flags: number, epoch: number, seq: number, pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + pcm.byteLength)
  const view = new DataView(buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint8(4, kind)
  view.setUint8(5, flags)
  view.setUint16(6, 0, true)
  view.setUint32(8, epoch >>> 0, true)
  view.setUint32(12, seq >>> 0, true)
  new Int16Array(buffer, HEADER_BYTES).set(pcm)

  return buffer
}

export function parseFrame(buffer: ArrayBuffer): BinaryFrame | null {
  if (buffer.byteLength < HEADER_BYTES) {
    return null
  }

  const view = new DataView(buffer)

  if (view.getUint32(0, true) !== MAGIC) {
    return null
  }

  // Payload must stay sample-aligned; a ragged tail byte would corrupt the
  // Int16 view (even-byte guard, mirroring the service side).
  const payloadBytes = buffer.byteLength - HEADER_BYTES
  const alignedBytes = payloadBytes - (payloadBytes % 2)

  return {
    epoch: view.getUint32(8, true),
    flags: view.getUint8(5),
    kind: view.getUint8(4),
    pcm: new Int16Array(buffer, HEADER_BYTES, alignedBytes / 2),
    seq: view.getUint32(12, true)
  }
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]))
    out[index] = sample < 0 ? sample * 0x80_00 : sample * 0x7f_ff
  }

  return out
}

export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length)

  for (let index = 0; index < input.length; index += 1) {
    out[index] = input[index] / 0x80_00
  }

  return out
}
