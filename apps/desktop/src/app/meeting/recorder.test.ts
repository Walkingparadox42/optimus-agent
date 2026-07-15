import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openBotVaultNote } = vi.hoisted(() => ({ openBotVaultNote: vi.fn() }))

vi.mock('@/store/vault-events', () => ({ openBotVaultNote }))

import { completeMeetingNote } from './recorder'
import { $meetingLastNote, $meetingPhase } from './store'

describe('meeting recorder completion', () => {
  beforeEach(() => {
    openBotVaultNote.mockReset()
    openBotVaultNote.mockResolvedValue(undefined)
    $meetingLastNote.set(null)
    $meetingPhase.set('transcribing')
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
