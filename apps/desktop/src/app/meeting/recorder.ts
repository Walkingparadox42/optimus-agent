/**
 * [Optimus Cockpit] Meeting recorder — M1.
 *
 * MediaRecorder mic capture (echoCancellation OFF — this wants the raw room,
 * not a cleaned near-end voice), one continuous recording, uploaded whole on
 * stop. M1 keeps the whole recording in memory (chunk-to-disk crash
 * insurance is M3). The transcribe endpoint URL + token are derived from the
 * voice settings so meetings and voice share one host/token.
 */

import { $voiceServerUrl, $voiceToken } from '@/app/voice/store'

import { $meetingElapsed, $meetingError, $meetingLastNote, $meetingPhase } from './store'

/** ws://host:9125/voice  ->  http://host:9125/transcribe */
function transcribeUrl(): string {
  const raw = $voiceServerUrl.get().trim()

  try {
    const url = new URL(raw)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = '/transcribe'

    return url.toString()
  } catch {
    return raw.replace(/^ws/, 'http').replace(/\/voice\/?$/, '') + '/transcribe'
  }
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }

  return 'audio/webm'
}

export class MeetingRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mimeType = 'audio/webm'
  private elapsedTimer: null | ReturnType<typeof setInterval> = null
  private startedAt = 0

  get recording(): boolean {
    return this.recorder?.state === 'recording'
  }

  async start(): Promise<void> {
    if (this.recording) {
      return
    }

    $meetingError.set(null)
    $meetingLastNote.set(null)

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false }
      })
    } catch {
      $meetingError.set('mic-denied')
      $meetingPhase.set('error')

      return
    }

    this.mimeType = pickMimeType()
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType })

    this.recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        this.chunks.push(event.data)
      }
    }

    // Timeslice so long recordings surface data periodically (and give M3 a
    // seam for disk flushing); 5s is coarse enough to stay cheap.
    this.recorder.start(5_000)
    this.startedAt = Date.now()
    $meetingElapsed.set(0)
    this.elapsedTimer = setInterval(() => {
      $meetingElapsed.set(Math.floor((Date.now() - this.startedAt) / 1000))
    }, 1_000)
    $meetingPhase.set('recording')
  }

  /** Stop, assemble the recording, upload for transcription. */
  async stop(): Promise<void> {
    const recorder = this.recorder

    if (!recorder || recorder.state === 'inactive') {
      return
    }

    const stopped = new Promise<void>(resolve => {
      recorder.onstop = () => resolve()
    })

    recorder.stop()
    await stopped

    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer)
      this.elapsedTimer = null
    }

    for (const track of this.stream?.getTracks() ?? []) {
      track.stop()
    }

    this.stream = null
    this.recorder = null

    const blob = new Blob(this.chunks, { type: this.mimeType })
    this.chunks = []

    if (blob.size === 0) {
      $meetingPhase.set('idle')

      return
    }

    await this.upload(blob)
  }

  private async upload(blob: Blob): Promise<void> {
    $meetingPhase.set('uploading')

    const token = $voiceToken.get().trim()
    const url = new URL(transcribeUrl())
    url.searchParams.set('token', token)
    // No title in M1 — the server timestamps the filename and falls back to a
    // "meeting" slug. A meaningful title is an M2 concern (derive from the
    // summary). Sending a timestamp here just doubled the date in the name.

    const form = new FormData()
    form.append('audio', blob, 'meeting.webm')

    // The server transcribes before responding; a long meeting can take
    // minutes. The phase flips to 'transcribing' once the bytes are sent.
    let sent = false

    const flip = setTimeout(() => {
      sent = true
      $meetingPhase.set('transcribing')
    }, 1_500)

    try {
      const response = await fetch(url.toString(), { body: form, method: 'POST' })

      clearTimeout(flip)

      if (!sent) {
        $meetingPhase.set('transcribing')
      }

      const data = (await response.json()) as { error?: string; note_path?: string }

      if (!response.ok || data.error) {
        $meetingError.set(data.error ?? `server ${response.status}`)
        $meetingPhase.set('error')

        return
      }

      $meetingLastNote.set(data.note_path ?? null)
      $meetingPhase.set('idle')
    } catch (error) {
      clearTimeout(flip)
      $meetingError.set(String(error).slice(0, 200))
      $meetingPhase.set('error')
    }
  }
}

export const meetingRecorder = new MeetingRecorder()
