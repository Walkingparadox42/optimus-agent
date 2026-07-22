import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $voiceServerUrl, $voiceToken } from '@/app/voice/store'

const { openBotVaultNote } = vi.hoisted(() => ({ openBotVaultNote: vi.fn() }))

vi.mock('@/store/vault-events', () => ({ openBotVaultNote }))

import { completeMeetingNote, meetingTranscribeRequestUrl } from './recorder'
import { $meetingLastNote, $meetingPhase } from './store'

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
})
