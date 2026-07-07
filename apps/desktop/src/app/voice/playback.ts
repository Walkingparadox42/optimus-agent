/**
 * [Optimus Cockpit] Voice TTS playback — Phase 4 P1D-1.
 *
 * The :9125 service sends TTS frames at SYNTHESIS speed, not realtime
 * (P1B finding, voice-protocol.md section 4 note): realtime pacing and
 * buffering are explicitly the client's job. Chunks are scheduled
 * back-to-back on an AudioContext clock.
 *
 * The played-samples high-water mark (ADR-0006 steps 3-4) is tracked here,
 * for ANSWER audio only: the service maps `played_samples` against the
 * answer's sentence offsets, so filler audio (announced by tts.filler,
 * delimited by its last-chunk flag) must not inflate the count. Every
 * chunk is tagged answer/filler when scheduled; the mark sums only answer
 * chunks' elapsed playback.
 */

import { pcm16ToFloat, VOICE_RATE } from './protocol'

interface ScheduledChunk {
  ctxStart: number
  isAnswer: boolean
  samples: number
  source: AudioBufferSourceNode
}

export class VoicePlaybackQueue {
  private context: AudioContext | null = null
  private cursor = 0
  private scheduled: ScheduledChunk[] = []
  /** Called when the queue drains (playback actually finished). */
  onDrain: (() => void) | null = null
  private drainTimer: null | ReturnType<typeof setTimeout> = null

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ sampleRate: VOICE_RATE })
      this.cursor = 0
    }

    void this.context.resume()

    return this.context
  }

  /** True while any scheduled audio has not finished playing. */
  get playing(): boolean {
    const context = this.context

    return context !== null && this.cursor > context.currentTime
  }

  enqueue(pcm: Int16Array, isAnswer: boolean): void {
    if (pcm.length === 0) {
      return
    }

    const context = this.ensureContext()
    const buffer = context.createBuffer(1, pcm.length, VOICE_RATE)
    buffer.getChannelData(0).set(pcm16ToFloat(pcm))

    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)

    // Back-to-back scheduling; a stall (cursor fell behind) restarts "now"
    // with a tiny guard so we never schedule in the past.
    const startAt = Math.max(this.cursor, context.currentTime + 0.02)
    source.start(startAt)
    this.cursor = startAt + pcm.length / VOICE_RATE
    this.scheduled.push({ ctxStart: startAt, isAnswer, samples: pcm.length, source })

    this.armDrainTimer()
  }

  /** Samples of ANSWER audio the speaker has actually emitted so far. */
  playedAnswerSamples(): number {
    const context = this.context

    if (!context) {
      return 0
    }

    const now = context.currentTime
    let played = 0

    for (const chunk of this.scheduled) {
      if (!chunk.isAnswer) {
        continue
      }

      const elapsed = (now - chunk.ctxStart) * VOICE_RATE
      played += Math.max(0, Math.min(chunk.samples, Math.round(elapsed)))
    }

    return played
  }

  /** Barge-in / stop: kill everything scheduled and clear the buffer. */
  flush(): void {
    for (const chunk of this.scheduled) {
      try {
        chunk.source.stop()
      } catch {
        // already ended
      }
    }

    this.scheduled = []
    this.cursor = 0

    if (this.drainTimer) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }
  }

  close(): void {
    this.flush()
    void this.context?.close()
    this.context = null
  }

  private armDrainTimer(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer)
    }

    const context = this.context

    if (!context) {
      return
    }

    const remainingMs = Math.max(0, (this.cursor - context.currentTime) * 1000) + 50
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null

      if (this.playing) {
        this.armDrainTimer()
      } else {
        this.onDrain?.()
      }
    }, remainingMs)
  }
}
