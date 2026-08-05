import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $voiceServerUrl, $voiceToken } from '@/app/voice/store'

const { openBotVaultNote } = vi.hoisted(() => ({ openBotVaultNote: vi.fn() }))

vi.mock('@/store/vault-events', () => ({ openBotVaultNote }))

import { completeMeetingNote, MeetingRecorder, meetingTranscribeRequestUrl } from './recorder'
import { $meetingElapsed, $meetingLastNote, $meetingPhase } from './store'

describe('meeting recorder completion', () => {
  beforeEach(() => {
    openBotVaultNote.mockReset()
    openBotVaultNote.mockResolvedValue(undefined)
    $meetingLastNote.set(null)
    $meetingPhase.set('transcribing')
    $voiceServerUrl.set('ws://192.168.0.116:9125/voice')
    $voiceToken.set('test-token')
  })

  it('routes the selected summary style without changing the transcribe endpoint', () => {
    const interview = new URL(meetingTranscribeRequestUrl('Dev interview', 'interview'))
    const rollback = new URL(meetingTranscribeRequestUrl('Weekly sync', 'meeting'))

    expect(interview.pathname).toBe('/transcribe')
    expect(interview.searchParams.get('token')).toBe('test-token')
    expect(interview.searchParams.get('title')).toBe('Dev interview')
    expect(interview.searchParams.get('summary_style')).toBe('interview')
    expect(rollback.searchParams.get('summary_style')).toBe('meeting')
  })

  it('opens the completed meeting note on the BotVault work surface', async () => {
    const notePath = '/mnt/vaults/BotVault/Optimus/00-Inbox/weekly-sync.md'

    await completeMeetingNote(notePath)

    expect(openBotVaultNote).toHaveBeenCalledWith(notePath)
    expect($meetingLastNote.get()).toBe(notePath)
    expect($meetingPhase.get()).toBe('idle')
  })

  it('keeps a saved meeting successful when preview navigation fails', async () => {
    const notePath = '/mnt/vaults/BotVault/Optimus/00-Inbox/weekly-sync.md'
    openBotVaultNote.mockRejectedValue(new Error('gateway disconnected'))

    await completeMeetingNote(notePath)

    expect($meetingLastNote.get()).toBe(notePath)
    expect($meetingPhase.get()).toBe('idle')
  })

  it('discards captured audio without uploading it for transcription', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    class FakeMediaRecorder {
      static isTypeSupported = () => true
      mimeType = 'audio/webm;codecs=opus'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      state: RecordingState = 'inactive'

      start() {
        this.state = 'recording'
      }

      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['captured audio']) })
        this.onstop?.()
      }
    }

    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream as unknown as MediaStream) }
    })

    const recorder = new MeetingRecorder()
    await recorder.start()
    $meetingElapsed.set(12)
    await recorder.discard()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    expect($meetingElapsed.get()).toBe(0)
    expect($meetingPhase.get()).toBe('idle')
  })

  it('discards stopped audio when the context prompt is cancelled', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    class FakeMediaRecorder {
      static isTypeSupported = () => true
      mimeType = 'audio/webm;codecs=opus'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      state: RecordingState = 'inactive'

      start() {
        this.state = 'recording'
      }

      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['captured audio']) })
        this.onstop?.()
      }
    }

    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream as unknown as MediaStream) }
    })

    const recorder = new MeetingRecorder()
    await recorder.start()
    await recorder.stop(() => null)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    expect($meetingPhase.get()).toBe('idle')
  })
})
