/**
 * [Optimus Cockpit] Always-on controller — Phase 4 P1D-2.
 *
 * Implements the decided D3 policy (Steve 2026-07-07): the WAKE WORD gates
 * session ENTRY; open-mic VAD runs INSIDE the conversation window; PTT
 * stays the always-available manual override.
 *
 * State machine over the spec section 8 modes:
 *   idle_wake_only  — every mic frame goes ONLY to the local wake engine.
 *                     Nothing leaves the machine (delta-4 privacy rule;
 *                     verified at the gate via service logs).
 *   wake detected   — chime + avatar ring (setAvatarListening), window
 *                     opens, 8s ack timer (woke but said nothing → close).
 *   window open     — energy VAD arms utterance start; frames stream only
 *                     between VAD-start and the server's silence endpoint
 *                     (stt.final). Speech during PLAYBACK uses the raised
 *                     threshold and triggers a real barge-in first.
 *   follow-up       — after playback drains, an 8s window keeps the
 *                     conversation hot without re-waking; timeout returns
 *                     to idle_wake_only.
 * Timeouts ratified by Steve 2026-07-07: 8s ack, 8s follow-up, no hard cap.
 */

import { setAvatarListening } from '@/store/avatar'

import { playWakeChime } from './chime'
import { voiceClient } from './client'
import { $voiceError, $voiceWakeState } from './store'
import { EnergyVad } from './vad'
import { WakeEngine } from './wake-engine'

const ACK_WINDOW_MS = 8_000
const FOLLOWUP_WINDOW_MS = 8_000

type WindowState = 'closed' | 'open'

export class AlwaysOnController {
  private wake = new WakeEngine()
  private vad = new EnergyVad()
  private enabled = false
  private window: WindowState = 'closed'
  private closeTimer: null | ReturnType<typeof setTimeout> = null
  private unsubscribe: Array<() => void> = []

  async enable(): Promise<void> {
    if (this.enabled) {
      return
    }

    $voiceWakeState.set('loading')

    try {
      await this.wake.load()
    } catch (error) {
      // Spec s9: failures explicit — the earlier silent catch here is what
      // reduced a loader-resolution 404 to an opaque "failed to load".
      console.error('[voice] wake engine load failed:', error)
      $voiceError.set(`wake engine: ${String(error).slice(0, 200)}`)
      $voiceWakeState.set('error')

      return
    }

    this.enabled = true
    this.wake.onWake = () => this.onWake()
    voiceClient.setTapListener(pcm => this.onTapFrame(pcm))

    this.unsubscribe = [
      // stt.final: utterance closed server-side; a turn is now running.
      voiceClient.on('stt.final', () => this.clearCloseTimer()),
      // The follow-up window starts when PLAYBACK finishes (drained), not
      // at response.done — audio arrives faster than realtime and the
      // window would burn while Piper is still audibly speaking.
      voiceClient.on('playback.drained', () => {
        if (this.window === 'open' && !voiceClient.busyWithTurn && !voiceClient.streaming) {
          this.armFollowup()
        }
      }),
      voiceClient.on('response.done', payload => {
        const status = (payload as { status?: string } | undefined)?.status

        // Gated/failed turns produce no audio; arm the follow-up directly.
        if (this.window === 'open' && (status === 'ignored' || !voiceClient.audible)) {
          this.armFollowup()
        }
      }),
      voiceClient.on('response.interrupted', () => {
        // A barge-in (voice or PTT) keeps the window open: the interrupter
        // is about to talk.
        if (this.window === 'open') {
          this.armCloseTimer(ACK_WINDOW_MS)
        }
      })
    ]

    this.vad.reset()
    this.wake.reset()
    $voiceWakeState.set('listening')
  }

  disable(): void {
    if (!this.enabled) {
      return
    }

    this.enabled = false
    this.closeWindow()
    voiceClient.setTapListener(null)

    for (const off of this.unsubscribe) {
      off()
    }

    this.unsubscribe = []
    $voiceWakeState.set('off')
  }

  /** Manual user panic/stop control: close a false wake/listening window,
   *  cancel any in-flight voice turn, then return to idle wake-word mode. */
  stop(): void {
    voiceClient.stop()
    this.closeWindow()
  }

  private onTapFrame(pcm: Int16Array): void {
    if (!this.enabled || voiceClient.pttHeld) {
      return // PTT override in progress — stay out of its way
    }

    if (this.window === 'closed') {
      // idle_wake_only: local wake inference only; frame never leaves.
      void this.wake.feed(pcm)

      return
    }

    // Window open.
    if (voiceClient.streaming) {
      voiceClient.feedUtteranceFrame(pcm)

      return
    }

    const speaking = voiceClient.audible

    if (this.vad.detect(pcm, speaking)) {
      if (speaking || voiceClient.busyWithTurn) {
        voiceClient.interrupt() // voice barge-in (raised threshold path)
      }

      if (voiceClient.startUtteranceStream()) {
        this.clearCloseTimer()
        voiceClient.sendModeSet('listening_for_turn')
        voiceClient.feedUtteranceFrame(pcm)
      }
    }
  }

  private onWake(): void {
    if (this.window === 'open') {
      return
    }

    this.window = 'open'
    playWakeChime()
    setAvatarListening(true)
    $voiceWakeState.set('window')
    voiceClient.sendModeSet('listening_for_turn')
    this.vad.reset()
    this.armCloseTimer(ACK_WINDOW_MS)
  }

  private armFollowup(): void {
    voiceClient.sendModeSet('waiting_for_followup')
    setAvatarListening(true)
    this.vad.reset()
    this.armCloseTimer(FOLLOWUP_WINDOW_MS)
  }

  private armCloseTimer(ms: number): void {
    this.clearCloseTimer()
    this.closeTimer = setTimeout(() => this.closeWindow(), ms)
  }

  private clearCloseTimer(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = null
    }
  }

  private closeWindow(): void {
    this.clearCloseTimer()

    if (this.window === 'open') {
      this.window = 'closed'
      voiceClient.sendModeSet('idle_wake_only')
      setAvatarListening(false)
    }

    this.wake.reset()

    if (this.enabled) {
      $voiceWakeState.set('listening')
    }
  }
}

export const alwaysOn = new AlwaysOnController()
