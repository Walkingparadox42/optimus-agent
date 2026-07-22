/**
 * [Optimus Cockpit] Meeting recorder state — M1.
 *
 * Mic-only meeting capture, separate from the :9125 conversational voice
 * protocol (that is turn-based; a 10-60 min recording is the wrong shape).
 * Records locally in the renderer, uploads the whole file on stop to the
 * voice service's POST /transcribe, which batch-transcribes, asks Hermes for
 * the summary, and writes the note to BotVault (Optimus/raw/meetings/).
 * Reuses the voice server URL + token settings.
 */

import { atom } from 'nanostores'

import { type Codec, persistentAtom } from '@/lib/persisted'

export type MeetingPhase = 'error' | 'idle' | 'prompting' | 'recording' | 'transcribing' | 'uploading'
export type MeetingSummaryStyle = 'interview' | 'meeting'

const summaryStyleCodec: Codec<MeetingSummaryStyle> = {
  decode: raw => (raw === 'meeting' ? 'meeting' : 'interview'),
  encode: value => value
}

export const $meetingPhase = atom<MeetingPhase>('idle')
// Elapsed recording time in whole seconds (drives the MM:SS display).
export const $meetingElapsed = atom(0)
// Path of the last transcript note written (shown as a success confirmation).
export const $meetingLastNote = atom<null | string>(null)
export const $meetingError = atom<null | string>(null)
// Interview is Steve's primary recorder workflow. Standard meeting is the
// one-click rollback to the original M2 prompt and output structure.
export const $meetingSummaryStyle = persistentAtom<MeetingSummaryStyle>(
  'optimus.meeting.summaryStyle',
  'interview',
  summaryStyleCodec
)
