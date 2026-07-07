/**
 * [Optimus Cockpit] Voice client state — Phase 4 P1D-1.
 *
 * Settings persist locally via the shared persistentAtom helper (same
 * mechanism as workspaceMode): the token is pasted once in the avatar pane
 * and lives ONLY in this machine's storage — never in the repo (decision:
 * Steve 2026-07-06). Live session state is plain atoms the VoiceClient
 * drives; the avatar pane renders off these plus $avatarState.
 */

import { atom } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'

export type VoiceConnectionPhase = 'connecting' | 'disconnected' | 'ready'
export type VoiceTurnPhase = 'capturing' | 'idle' | 'speaking' | 'thinking'

export const $voiceServerUrl = persistentAtom(
  'optimus.voice.serverUrl',
  'ws://192.168.0.116:9125/voice',
  Codecs.text
)

// Pasted once; persisted locally like other cockpit settings; never committed.
export const $voiceToken = persistentAtom('optimus.voice.token', '', Codecs.text)

export const $voiceConnection = atom<VoiceConnectionPhase>('disconnected')
export const $voiceTurnPhase = atom<VoiceTurnPhase>('idle')
export const $voiceTranscript = atom('')
export const $voiceAnswer = atom('')
export const $voiceError = atom<null | string>(null)

// P1D-2 data-gathering (session-only, not persisted): when on, PTT captures
// WITHOUT barging in, so the mic is hot while Piper plays through the
// speakers — the ADR-0008 echo topology. Whatever transcript comes back is
// the measured leakage through Chromium's AEC. Kept as a debug tool (the
// measurement it produced decided D3 and closed ADR-0008's AEC item).
export const $voiceEchoTest = atom(false)

// P1D-2 always-on: persisted preference (survives restarts like the other
// cockpit settings) + live wake-engine state for the UI/avatar.
export type VoiceWakeState = 'error' | 'listening' | 'loading' | 'off' | 'window'

export const $voiceAlwaysOn = persistentAtom('optimus.voice.alwaysOn', false, Codecs.bool)
export const $voiceWakeState = atom<VoiceWakeState>('off')
