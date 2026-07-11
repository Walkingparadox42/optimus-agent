import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOTVAULT_PATH } from '@/app/botvault/use-vault-tree'

import {
  $vaultNoteActivity,
  $vaultNoteRefresh,
  notifyVaultNoteChanged,
  vaultPathFromToolPayload
} from './vault-events'

const NOTE = `${BOTVAULT_PATH}/Inbox/groceries.md`

describe('vaultPathFromToolPayload', () => {
  it('derives the path from a write tool with a vault-rooted path arg', () => {
    expect(vaultPathFromToolPayload({ args: { path: NOTE }, name: 'write_file' })).toBe(NOTE)
  })

  it('reads JSON-encoded and nested argument shapes', () => {
    expect(vaultPathFromToolPayload({ args: JSON.stringify({ file_path: NOTE }), name: 'apply_patch' })).toBe(NOTE)
    expect(vaultPathFromToolPayload({ input: { arguments: { path: NOTE } }, name: 'edit_file' })).toBe(NOTE)
  })

  it('ignores read-only tools even when they carry a vault path', () => {
    expect(vaultPathFromToolPayload({ args: { path: NOTE }, name: 'read_file' })).toBeNull()
  })

  it('ignores writes outside the vault root', () => {
    expect(vaultPathFromToolPayload({ args: { path: '/root/projects/notes.md' }, name: 'write_file' })).toBeNull()
    // Prefix-sibling directory must not match (BotVault vs BotVault-archive).
    expect(vaultPathFromToolPayload({ args: { path: `${BOTVAULT_PATH}-archive/x.md` }, name: 'write_file' })).toBeNull()
  })

  it('treats an inline_diff as a write signal regardless of tool name', () => {
    expect(vaultPathFromToolPayload({ args: { path: NOTE }, inline_diff: '+++ x', name: 'mystery_tool' })).toBe(NOTE)
  })

  it('returns null when no argument shape matches', () => {
    expect(vaultPathFromToolPayload({ args: { content: 'x' }, name: 'write_file' })).toBeNull()
  })
})

describe('notifyVaultNoteChanged', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    $vaultNoteActivity.set(null)
    $vaultNoteRefresh.set(null)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('fires activity on the leading edge, refresh only after the debounce', () => {
    notifyVaultNoteChanged(NOTE, 'session')

    expect($vaultNoteActivity.get()?.path).toBe(NOTE)
    expect($vaultNoteRefresh.get()).toBeNull()

    vi.advanceTimersByTime(500)

    expect($vaultNoteRefresh.get()?.path).toBe(NOTE)
  })

  it('coalesces a burst of writes into one refresh', () => {
    let refreshes = 0

    const unsubscribe = $vaultNoteRefresh.listen(() => {
      refreshes += 1
    })

    notifyVaultNoteChanged(NOTE, 'session')
    vi.advanceTimersByTime(200)
    notifyVaultNoteChanged(NOTE, 'session')
    vi.advanceTimersByTime(200)
    notifyVaultNoteChanged(NOTE, 'session')
    vi.advanceTimersByTime(500)

    expect(refreshes).toBe(1)
    unsubscribe()
  })

  it('debounces per path — two notes each get their refresh', () => {
    const other = `${BOTVAULT_PATH}/Inbox/pricing.md`
    const seen: string[] = []

    const unsubscribe = $vaultNoteRefresh.listen(event => {
      if (event) {
        seen.push(event.path)
      }
    })

    notifyVaultNoteChanged(NOTE, 'session')
    notifyVaultNoteChanged(other, 'session')
    vi.advanceTimersByTime(500)

    expect(seen.sort()).toEqual([NOTE, other].sort())
    unsubscribe()
  })

  it('every activity event carries a fresh tick', () => {
    notifyVaultNoteChanged(NOTE, 'session')
    const first = $vaultNoteActivity.get()?.tick

    notifyVaultNoteChanged(NOTE, 'session')

    expect($vaultNoteActivity.get()?.tick).not.toBe(first)
  })
})
