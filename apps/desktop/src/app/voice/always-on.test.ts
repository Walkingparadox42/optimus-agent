import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  feedUtteranceFrame: vi.fn(),
  sendModeSet: vi.fn(),
  setAvatarListening: vi.fn(),
  startUtteranceStream: vi.fn(() => true),
  tap: null as null | ((pcm: Int16Array) => void)
}))

vi.mock('@/store/avatar', () => ({ setAvatarListening: mocks.setAvatarListening }))
vi.mock('./chime', () => ({ playWakeChime: vi.fn() }))
vi.mock('./client', () => ({
  voiceClient: {
    audible: false,
    busyWithTurn: false,
    feedUtteranceFrame: mocks.feedUtteranceFrame,
    interrupt: vi.fn(),
    on: vi.fn(() => vi.fn()),
    pttHeld: false,
    sendModeSet: mocks.sendModeSet,
    setTapListener: vi.fn((listener: null | ((pcm: Int16Array) => void)) => {
      mocks.tap = listener
    }),
    startUtteranceStream: mocks.startUtteranceStream,
    stop: vi.fn(),
    streaming: false
  }
}))
vi.mock('./vad', () => ({
  EnergyVad: class {
    detect() {
      return true
    }
    reset() {}
  }
}))
vi.mock('./wake-engine', () => ({
  WakeEngine: class {
    onWake: null | (() => void) = null
    async load() {}
    async feed() {}
    reset() {}
  }
}))

import { AlwaysOnController, CONVERSATION_MODE } from './always-on'

describe('AlwaysOnController conversation mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.tap = null
  })

  it('opens immediately without an acknowledgement or follow-up timeout', async () => {
    const controller = new AlwaysOnController()
    controller.setConversationMode(true)
    await controller.enable()

    expect(mocks.sendModeSet).toHaveBeenLastCalledWith(CONVERSATION_MODE)
    expect(mocks.setAvatarListening).toHaveBeenLastCalledWith(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the patient endpoint policy when VAD starts an utterance', async () => {
    const controller = new AlwaysOnController()
    controller.setConversationMode(true)
    await controller.enable()

    mocks.tap?.(new Int16Array([1, 2, 3]))

    expect(mocks.startUtteranceStream).toHaveBeenCalled()
    expect(mocks.sendModeSet).toHaveBeenLastCalledWith(CONVERSATION_MODE)
    expect(mocks.feedUtteranceFrame).toHaveBeenCalled()
  })

  it('returns to wake-only mode when switched off', async () => {
    const controller = new AlwaysOnController()
    controller.setConversationMode(true)
    await controller.enable()

    controller.setConversationMode(false)

    expect(mocks.sendModeSet).toHaveBeenLastCalledWith('idle_wake_only')
    expect(mocks.setAvatarListening).toHaveBeenLastCalledWith(false)
  })
})
