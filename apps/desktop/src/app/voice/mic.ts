/**
 * [Optimus Cockpit] Mic capture — Phase 4 P1D-1 (push-to-talk).
 *
 * getUserMedia with echoCancellation on (ADR-0008's first line of echo
 * defense — the deeper AEC question is deliberately punted to P1D-2, where
 * always-on mode makes it real). Capture runs through an AudioWorklet
 * loaded from a Blob URL (no bundler config), on an AudioContext pinned to
 * 16 kHz so Chromium does the resample from the hardware rate; the worklet
 * ships raw Float32 blocks to the main thread, which frames them into
 * 100 ms PCM16 chunks for the kind=1 uplink.
 *
 * The mic stream itself stays open between utterances while capture is
 * "armed" only during PTT hold — pausing CAPTURE is a client choice here;
 * ADR-0008's "mic stays live" rule binds always-on mode (P1D-2), not PTT.
 */

import { floatToPcm16, FRAME_SAMPLES, VOICE_RATE } from './protocol'

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      this.port.postMessage(channel.slice(0))
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

export class MicCapture {
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private stream: MediaStream | null = null
  private pending = new Float32Array(0)
  private capturing = false
  /** Receives one 100 ms PCM16 frame at a time while capturing. */
  onFrame: ((pcm: Int16Array) => void) | null = null

  async open(): Promise<void> {
    if (this.context) {
      return
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    })

    const context = new AudioContext({ sampleRate: VOICE_RATE })
    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))

    try {
      await context.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    const source = context.createMediaStreamSource(this.stream)
    const node = new AudioWorkletNode(context, 'pcm-capture')

    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!this.capturing) {
        return
      }

      const merged = new Float32Array(this.pending.length + event.data.length)
      merged.set(this.pending)
      merged.set(event.data, this.pending.length)

      let offset = 0

      while (merged.length - offset >= FRAME_SAMPLES) {
        this.onFrame?.(floatToPcm16(merged.subarray(offset, offset + FRAME_SAMPLES)))
        offset += FRAME_SAMPLES
      }

      this.pending = merged.slice(offset)
    }

    source.connect(node)
    this.context = context
    this.node = node
  }

  /** PTT down: start shipping frames. */
  start(): void {
    this.pending = new Float32Array(0)
    this.capturing = true
    void this.context?.resume()
  }

  /** PTT up: stop shipping; flush the sub-frame tail as a final short frame. */
  stop(): Int16Array | null {
    this.capturing = false

    if (this.pending.length === 0) {
      return null
    }

    const tail = floatToPcm16(this.pending)
    this.pending = new Float32Array(0)

    return tail
  }

  close(): void {
    this.capturing = false
    this.node?.disconnect()
    this.node = null

    for (const track of this.stream?.getTracks() ?? []) {
      track.stop()
    }

    this.stream = null
    void this.context?.close()
    this.context = null
  }
}
