/**
 * [Optimus Cockpit] Voice session client — Phase 4 P1D-1 (push-to-talk).
 *
 * The renderer owns the microphone (ADR-0013): this client speaks the
 * :9125 WS protocol directly (second socket alongside the tui_gateway
 * connection — it does not replace it). Manual click-to-talk streams kind=1
 * mic frames until the service's silence endpoint commits the utterance; a
 * click while the assistant is audible is a barge-in (voice.interrupt
 * carrying the played-samples high-water mark, ADR-0006 steps 3-4).
 *
 * Epoch discipline (ADR-0005): the client tracks generation_epoch and
 * drops any delta or audio frame from an older epoch — the server already
 * discards stale events, this is the client-side backstop the spec
 * requires. tts.playback.stop semantics under burst sending: "barge-in"
 * flushes the buffer NOW; "end" only marks that no more frames are coming
 * (the service finishes SENDING long before playback finishes — flushing
 * on "end" would amputate the un-played tail).
 */

import { setAvatarListening } from '@/store/avatar'
import { setVoicePlaybackState } from '@/store/voice-playback'

import { MicCapture } from './mic'
import { VoicePlaybackQueue } from './playback'
import { FLAG_LAST, KIND_MIC, KIND_TTS, packFrame, parseFrame, type ServerMessage } from './protocol'
import {
  $voiceAnswer,
  $voiceConnection,
  $voiceEchoTest,
  $voiceError,
  $voiceTranscript,
  $voiceTurnPhase
} from './store'

/** Lifecycle signals the always-on controller (P1D-2) listens to. */
export type VoiceClientEvent = 'playback.drained' | 'response.done' | 'response.interrupted' | 'stt.final'

export class VoiceClient {
  private ws: null | WebSocket = null
  private mic = new MicCapture()
  private playback = new VoicePlaybackQueue()
  private epoch = 0
  private micSeq = 0
  private playbackSequence = 0
  private holding = false
  // P1D-2: true while the always-on controller streams an utterance
  // (VAD-opened, no PTT hold).
  private streamingUtterance = false
  private clickTalking = false
  private turnDone = false
  // Set by a tts.filler announcement; cleared when that stream's last-chunk
  // flag arrives. Filler audio must not count toward played_samples.
  private incomingStreamIsFiller = false
  private listeners = new Map<VoiceClientEvent, Set<(payload?: unknown) => void>>()

  constructor() {
    this.playback.onDrain = () => {
      if (this.turnDone && !this.holding) {
        this.setPhase('idle')
      }

      this.setSpeakingIndicator(false)
      this.emit('playback.drained')
    }

    this.mic.onFrame = pcm => {
      this.ws?.send(packFrame(KIND_MIC, 0, this.epoch, this.micSeq, pcm))
      this.micSeq += 1
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get busyWithTurn(): boolean {
    const phase = $voiceTurnPhase.get()

    return phase === 'thinking' || phase === 'speaking'
  }

  get audible(): boolean {
    return this.playback.playing
  }

  get pttHeld(): boolean {
    return this.holding
  }

  on(event: VoiceClientEvent, listener: (payload?: unknown) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)

    return () => void set.delete(listener)
  }

  private emit(event: VoiceClientEvent, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload)
    }
  }

  /** Mic tap for the always-on controller: every frame while the mic is
   *  open, PTT or not. Frames stay local unless explicitly forwarded. */
  setTapListener(listener: ((pcm: Int16Array) => void) | null): void {
    this.mic.onTap = listener
  }

  /** Inform the service of the client's window mode (spec session.mode.set)
   *  so its silence-endpoint windows adapt. */
  sendModeSet(mode: string): void {
    if (this.connected) {
      this.ws?.send(JSON.stringify({ message: 'session.mode.set', mode }))
    }
  }

  /** P1D-2: begin a VAD-opened utterance (no PTT). Frames are forwarded via
   *  feedUtteranceFrame; the SERVER ends the utterance (silence endpoint),
   *  signalled back by stt.final. */
  startUtteranceStream({ allowBusy = false }: { allowBusy?: boolean } = {}): boolean {
    if (!this.connected || this.holding || (!allowBusy && this.busyWithTurn)) {
      return false
    }

    this.streamingUtterance = true
    this.micSeq = 0
    this.turnDone = false
    $voiceTranscript.set('')
    $voiceAnswer.set('')
    this.setPhase('capturing')
    setAvatarListening(true)

    return true
  }

  /** Manual click-to-talk: latch mic streaming on until the server silence
   *  endpoint closes the utterance, or until the user presses Stop. */
  clickToTalk(): void {
    if (!this.connected || this.holding || this.streamingUtterance) {
      return
    }

    if (this.playback.playing || this.busyWithTurn) {
      this.bargeIn()
    }

    if (!this.startUtteranceStream({ allowBusy: true })) {
      return
    }

    this.clickTalking = true
    this.sendModeSet('listening_for_turn')
    this.mic.start()
  }

  feedUtteranceFrame(pcm: Int16Array): void {
    if (!this.streamingUtterance) {
      return
    }

    this.ws?.send(packFrame(KIND_MIC, 0, this.epoch, this.micSeq, pcm))
    this.micSeq += 1
  }

  get streaming(): boolean {
    return this.streamingUtterance
  }

  /** Public barge-in for the always-on controller (voice-triggered). */
  interrupt(): void {
    this.bargeIn()
  }

  /** Manual stop from the avatar pane: cancel any live run/playback/capture
   *  and return the client-side turn UI to idle without dropping the socket. */
  stop(): void {
    if (this.connected) {
      this.bargeIn()
    } else {
      this.playback.flush()
      this.setSpeakingIndicator(false)
    }

    if (this.holding) {
      this.holding = false
      this.mic.stop()
    }

    if (this.clickTalking) {
      this.clickTalking = false
      this.mic.stop()
    }

    this.streamingUtterance = false
    this.turnDone = false
    setAvatarListening(false)
    this.setPhase('idle')
  }

  async connect(serverUrl: string, token: string): Promise<void> {
    if (this.ws) {
      return
    }

    $voiceError.set(null)
    $voiceConnection.set('connecting')

    try {
      await this.mic.open()
    } catch {
      $voiceConnection.set('disconnected')
      $voiceError.set('mic-denied')

      return
    }

    const ws = new WebSocket(`${serverUrl}?token=${encodeURIComponent(token)}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ message: 'session.start', mode: 'conversation_active' }))
    }

    ws.onmessage = event => {
      if (typeof event.data === 'string') {
        this.onJson(JSON.parse(event.data) as ServerMessage)
      } else {
        this.onBinary(event.data as ArrayBuffer)
      }
    }

    ws.onerror = () => {
      $voiceError.set('connection-failed')
    }

    ws.onclose = () => {
      this.ws = null
      this.teardownTurnState()
      $voiceConnection.set('disconnected')
    }
  }

  disconnect(): void {
    // session.end first so the service tears down cleanly (its disconnect
    // backstop would also stop any live run — P0.7 — but be explicit).
    if (this.connected) {
      this.ws?.send(JSON.stringify({ message: 'session.end' }))
    }

    this.ws?.close()
    this.ws = null
    this.teardownTurnState()
    this.mic.close()
    this.playback.close()
    $voiceConnection.set('disconnected')
  }

  /** PTT down. A press while the assistant is audible is a barge-in —
   *  unless the echo-test toggle is on (P1D-2 data gathering): then capture
   *  runs WITH playback still audible, so the transcript measures what
   *  leaks through Chromium's AEC (ADR-0008 topology). */
  pttDown(): void {
    if (!this.connected) {
      return
    }

    const echoTest = $voiceEchoTest.get()

    if (
      !echoTest &&
      (this.playback.playing || $voiceTurnPhase.get() === 'thinking' || $voiceTurnPhase.get() === 'speaking')
    ) {
      this.bargeIn()
    }

    this.holding = true
    this.micSeq = 0

    if (!echoTest) {
      this.turnDone = false
    }

    $voiceTranscript.set('')
    $voiceAnswer.set('')
    this.mic.start()
    this.setPhase('capturing')
    setAvatarListening(true)
  }

  /** PTT up: flush the tail frame, commit the utterance. */
  pttUp(): void {
    if (!this.holding) {
      return
    }

    this.holding = false
    const tail = this.mic.stop()

    if (tail && tail.length > 0) {
      this.ws?.send(packFrame(KIND_MIC, 0, this.epoch, this.micSeq, tail))
      this.micSeq += 1
    }

    setAvatarListening(false)

    if (this.micSeq === 0) {
      // Nothing captured (tap without audio): no commit, back to idle.
      this.setPhase('idle')

      return
    }

    this.ws?.send(JSON.stringify({ message: 'audio.input.commit' }))
    this.setPhase('thinking')
  }

  private bargeIn(): void {
    const played = this.playback.playedAnswerSamples()
    this.ws?.send(JSON.stringify({ message: 'voice.interrupt', played_samples: played }))
    // Flush immediately — do not wait for tts.playback.stop to round-trip;
    // the whole point of barge-in is that audio dies NOW (spec section 6).
    this.playback.flush()
    this.setSpeakingIndicator(false)
  }

  private onJson(message: ServerMessage): void {
    switch (message.message) {
      case 'agent.text.delta': {
        if (message.generation_epoch < this.epoch) {
          return // stale-epoch backstop
        }

        $voiceAnswer.set($voiceAnswer.get() + String(message.text ?? ''))

        break
      }

      case 'error': {
        $voiceError.set(String(message.text ?? 'unknown'))

        break
      }

      case 'response.done': {
        this.turnDone = true

        if (message.status === 'ignored' || !this.playback.playing) {
          this.setPhase('idle')
          this.setSpeakingIndicator(false)
        }

        this.emit('response.done', message)

        break
      }

      case 'response.interrupted': {
        this.epoch = message.generation_epoch
        this.playback.flush()
        this.setSpeakingIndicator(false)

        if (!this.holding && !this.streamingUtterance) {
          this.setPhase('idle')
        }

        this.emit('response.interrupted', message)

        break
      }

      case 'session.ready': {
        this.epoch = message.generation_epoch
        $voiceConnection.set('ready')
        this.setPhase('idle')

        break
      }

      case 'stt.final': {
        $voiceTranscript.set(String(message.text ?? ''))

        // A VAD-opened utterance ends when the SERVER endpoints it.
        if (this.streamingUtterance) {
          this.streamingUtterance = false

          if (this.clickTalking) {
            this.clickTalking = false
            this.mic.stop()
          }

          setAvatarListening(false)
          this.setPhase('thinking')
        }

        this.emit('stt.final', message)

        break
      }

      case 'stt.partial': {
        $voiceTranscript.set(String(message.text ?? ''))

        break
      }

      case 'tts.filler': {
        this.incomingStreamIsFiller = true

        break
      }

      case 'tts.playback.stop': {
        if (message.reason === 'barge-in') {
          this.playback.flush()
          this.setSpeakingIndicator(false)
        }

        // reason "end": no more frames coming; let the buffer drain.
        break
      }

      default:
        // tool.started / tool.result etc.: no UI surface in P1D-1.
        break
    }
  }

  private onBinary(buffer: ArrayBuffer): void {
    const frame = parseFrame(buffer)

    if (!frame || frame.kind !== KIND_TTS) {
      return
    }

    if (frame.epoch < this.epoch) {
      return // stale audio from a superseded response (ADR-0005)
    }

    const isAnswer = !this.incomingStreamIsFiller

    if (frame.flags & FLAG_LAST) {
      this.incomingStreamIsFiller = false
    }

    if (frame.pcm.length > 0) {
      this.playback.enqueue(frame.pcm, isAnswer)

      if ($voiceTurnPhase.get() !== 'capturing') {
        this.setPhase('speaking')
      }

      this.setSpeakingIndicator(true)
    }
  }

  private setPhase(phase: 'capturing' | 'idle' | 'speaking' | 'thinking'): void {
    $voiceTurnPhase.set(phase)
  }

  private setSpeakingIndicator(speaking: boolean): void {
    this.playbackSequence += 1
    setVoicePlaybackState({
      audioElement: null,
      messageId: null,
      sequence: this.playbackSequence,
      source: speaking ? 'voice-conversation' : null,
      status: speaking ? 'speaking' : 'idle'
    })
  }

  private teardownTurnState(): void {
    this.holding = false
    this.streamingUtterance = false
    this.clickTalking = false
    this.turnDone = false
    this.incomingStreamIsFiller = false
    this.playback.flush()
    this.setSpeakingIndicator(false)
    setAvatarListening(false)
    $voiceTurnPhase.set('idle')
  }
}

/** One client per renderer window; the avatar pane mounts/unmounts around it. */
export const voiceClient = new VoiceClient()
