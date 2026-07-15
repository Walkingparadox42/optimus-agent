import { describe, expect, it } from 'vitest'

import { parseVaultChangeMessage, vaultEventsUrl } from './live-events'

describe('BotVault authoritative live events', () => {
  it('derives the watcher endpoint from the configured voice host', () => {
    expect(vaultEventsUrl('ws://192.168.0.116:9125/voice')).toBe('ws://192.168.0.116:9128/events')
    expect(vaultEventsUrl('wss://optimus.example/voice?token=secret')).toBe('wss://optimus.example:9128/events')
    expect(vaultEventsUrl('not a url')).toBeNull()
  })

  it('accepts vault note events and rejects malformed or out-of-vault paths', () => {
    expect(
      parseVaultChangeMessage(
        JSON.stringify({
          kind: 'modified',
          path: '/mnt/vaults/BotVault/Optimus/brainstorm.md',
          timestamp: 123,
          type: 'note.changed'
        })
      )
    ).toEqual({
      kind: 'modified',
      path: '/mnt/vaults/BotVault/Optimus/brainstorm.md',
      timestamp: 123,
      type: 'note.changed'
    })
    expect(
      parseVaultChangeMessage(
        JSON.stringify({ kind: 'modified', path: '/etc/passwd', timestamp: 123, type: 'note.changed' })
      )
    ).toBeNull()
    expect(parseVaultChangeMessage('{bad json')).toBeNull()
  })
})
