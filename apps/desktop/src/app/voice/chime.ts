/**
 * [Optimus Cockpit] Wake-ack chime — Phase 4 P1D-2.
 *
 * Decision (Steve 2026-07-07): chime + avatar ring, no spoken ack (Piper
 * "Yes?" stays a future preference). Synthesized with WebAudio — zero
 * assets, fires instantly with no round trip: two quick rising sine tones,
 * ~220 ms total.
 */

let context: AudioContext | null = null

export function playWakeChime(): void {
  if (!context || context.state === 'closed') {
    context = new AudioContext()
  }

  void context.resume()

  const now = context.currentTime

  for (const [frequency, start] of [
    [880, 0],
    [1_318.5, 0.1]
  ] as const) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0, now + start)
    gain.gain.linearRampToValueAtTime(0.25, now + start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.12)
    osc.connect(gain)
    gain.connect(context.destination)
    osc.start(now + start)
    osc.stop(now + start + 0.13)
  }
}
