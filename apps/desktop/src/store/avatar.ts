/**
 * [Optimus Cockpit] Avatar presence state — Phase 1 increment 2.
 *
 * Derives the cockpit avatar's presence state (idle / listening / thinking /
 * speaking / tool-use, per CLAUDE.md) from signals the app already tracks:
 * the pet-activity atom (reasoning / toolRunning / awaitingInput / error),
 * the chat `$busy` flag, and voice playback. `listening` has no store-level
 * source yet — mic state lives inside the composer hooks — so it's a settable
 * stub atom the voice phase (CT115 :9125 WS) will drive later.
 *
 * Deliberately mirrors the shape of `derivePetState` (store/pet.ts) so the two
 * presence surfaces never drift in how they read the same signals.
 */

import { atom, computed } from 'nanostores'

import { $petActivity, type PetActivity } from '@/store/pet'
import { $busy } from '@/store/session'
import { $voicePlayback, type VoicePlaybackStatus } from '@/store/voice-playback'

export type AvatarState = 'error' | 'idle' | 'listening' | 'speaking' | 'thinking' | 'toolUse' | 'waiting'

/** Mic-capture stub. Fed by the future voice-session client; until then the
 *  avatar simply never enters `listening`. */
export const $avatarListening = atom(false)

export const setAvatarListening = (on: boolean) => $avatarListening.set(on)

/**
 * Priority (highest first): error → speaking → listening → waiting → tool-use
 * → thinking → idle. Speaking outranks listening (the avatar is talking);
 * `waiting` (a clarify/approval blocking on the user) outranks the in-flight
 * signals because the turn is paused on Steve, not working. Steady flags only
 * count mid-turn — same stale-flag guard as the pet.
 */
export function deriveAvatarState(input: {
  activity: PetActivity
  busy: boolean
  listening: boolean
  playbackStatus: VoicePlaybackStatus
}): AvatarState {
  const live = input.activity.busy ?? input.busy

  if (input.activity.error) {
    return 'error'
  }

  // 'preparing' counts as speaking so the face lights up while TTS renders,
  // not only once audio starts.
  if (input.playbackStatus !== 'idle') {
    return 'speaking'
  }

  if (input.listening) {
    return 'listening'
  }

  if (input.activity.awaitingInput) {
    return 'waiting'
  }

  if (live && input.activity.toolRunning) {
    return 'toolUse'
  }

  if (live) {
    return 'thinking'
  }

  return 'idle'
}

export const $avatarState = computed(
  [$petActivity, $busy, $avatarListening, $voicePlayback],
  (activity, busy, listening, playback): AvatarState =>
    deriveAvatarState({ activity, busy, listening, playbackStatus: playback.status })
)
