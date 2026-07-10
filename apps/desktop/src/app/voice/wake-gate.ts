import { frameRms } from './vad'

const WAKE_PREFLIGHT_RMS = 350
const WAKE_PREFLIGHT_FRAMES = 5
const WAKE_CONFIRM_WINDOW_MS = 900
const WAKE_CONFIRM_HITS = 2

export interface WakeGateClock {
  now(): number
}

export class WakeGate {
  private hitTimes: number[] = []
  private voicedFrames = 0

  constructor(private clock: WakeGateClock = Date) {}

  reset(): void {
    this.hitTimes = []
    this.voicedFrames = 0
  }

  updateAudio(pcm: Int16Array): void {
    if (frameRms(pcm) >= WAKE_PREFLIGHT_RMS) {
      this.voicedFrames = Math.min(this.voicedFrames + 1, WAKE_PREFLIGHT_FRAMES)

      return
    }

    this.voicedFrames = Math.max(0, this.voicedFrames - 1)
  }

  acceptsWakeScore(): boolean {
    const now = this.clock.now()
    this.hitTimes = this.hitTimes.filter(hitTime => now - hitTime <= WAKE_CONFIRM_WINDOW_MS)
    this.hitTimes.push(now)

    return this.voicedFrames >= WAKE_PREFLIGHT_FRAMES && this.hitTimes.length >= WAKE_CONFIRM_HITS
  }
}
