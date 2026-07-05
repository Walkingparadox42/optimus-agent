import { describe, expect, it } from 'vitest'

import { type AvatarState, deriveAvatarState } from './avatar'

const derive = (over: Partial<Parameters<typeof deriveAvatarState>[0]> = {}): AvatarState =>
  deriveAvatarState({ activity: {}, busy: false, listening: false, playbackStatus: 'idle', ...over })

describe('deriveAvatarState', () => {
  it('is idle with no signals', () => {
    expect(derive()).toBe('idle')
  })

  it('error outranks everything', () => {
    expect(
      derive({
        activity: { awaitingInput: true, busy: true, error: true, toolRunning: true },
        listening: true,
        playbackStatus: 'speaking'
      })
    ).toBe('error')
  })

  it('speaking while TTS plays, including the preparing phase', () => {
    expect(derive({ playbackStatus: 'speaking' })).toBe('speaking')
    expect(derive({ playbackStatus: 'preparing' })).toBe('speaking')
  })

  it('speaking outranks listening', () => {
    expect(derive({ listening: true, playbackStatus: 'speaking' })).toBe('speaking')
  })

  it('listening outranks the in-flight signals', () => {
    expect(derive({ activity: { busy: true, toolRunning: true }, listening: true })).toBe('listening')
  })

  it('waiting (blocked on user input) outranks tool-use and thinking', () => {
    expect(derive({ activity: { awaitingInput: true, busy: true, toolRunning: true } })).toBe('waiting')
  })

  it('tool-use while a tool runs mid-turn', () => {
    expect(derive({ activity: { busy: true, toolRunning: true } })).toBe('toolUse')
  })

  it('thinking while busy without a tool', () => {
    expect(derive({ activity: { busy: true } })).toBe('thinking')
    expect(derive({ busy: true })).toBe('thinking')
  })

  it('ignores a stale toolRunning flag once the turn is over', () => {
    expect(derive({ activity: { busy: false, toolRunning: true } })).toBe('idle')
  })
})
