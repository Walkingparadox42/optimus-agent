/**
 * [Optimus Cockpit] Energy VAD — Phase 4 P1D-2 (in-window utterance start).
 *
 * Detects the START of intentional speech inside an open conversation
 * window. Utterance END stays server-side (the P1C silence endpoint) —
 * this gate only decides when to begin streaming, and when speech over
 * live playback counts as a barge-in (raised threshold + longer sustain,
 * the ADR-0008-sanctioned trick; safe because AEC is measured-clean, so
 * Piper's own voice never reaches the mic signal at speech level).
 */

export const VAD_START_RMS = 500 // matches the service's voice threshold
export const VAD_START_FRAMES = 2 // 200 ms sustained
export const VAD_BARGE_RMS = 1_500 // raised during SPEAKING
export const VAD_BARGE_FRAMES = 3 // 300 ms sustained

export function frameRms(pcm: Int16Array): number {
  if (pcm.length === 0) {
    return 0
  }

  let sum = 0

  for (let index = 0; index < pcm.length; index += 1) {
    sum += pcm[index] * pcm[index]
  }

  return Math.sqrt(sum / pcm.length)
}

export class EnergyVad {
  private run = 0

  reset(): void {
    this.run = 0
  }

  /** Feed one frame; returns true when the sustain requirement is met. */
  detect(pcm: Int16Array, raised: boolean): boolean {
    const threshold = raised ? VAD_BARGE_RMS : VAD_START_RMS
    const needed = raised ? VAD_BARGE_FRAMES : VAD_START_FRAMES

    if (frameRms(pcm) >= threshold) {
      this.run += 1
    } else {
      this.run = 0
    }

    if (this.run >= needed) {
      this.run = 0

      return true
    }

    return false
  }
}
