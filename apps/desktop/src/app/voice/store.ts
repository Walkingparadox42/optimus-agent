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
