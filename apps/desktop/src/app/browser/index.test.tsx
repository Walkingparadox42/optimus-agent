import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeRfb extends EventTarget {
  clipboardPasteFrom: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  scales: boolean[]
  sendKey: ReturnType<typeof vi.fn>
}

const rfbState = vi.hoisted(() => ({ instances: [] as FakeRfb[] }))

vi.mock('@novnc/novnc', () => {
  class MockRFB extends EventTarget implements FakeRfb {
    clipboardPasteFrom = vi.fn()
    disconnect = vi.fn()
    focus = vi.fn()
    scales: boolean[] = []
    sendKey = vi.fn()

    constructor() {
      super()
      rfbState.instances.push(this)
    }

    set scaleViewport(value: boolean) {
      this.scales.push(value)
    }
  }

  return { default: MockRFB }
})

vi.mock('@/components/ui/loader', () => ({ Loader: () => null }))

import { BrowserPane } from './index'

const readClipboard = vi.fn<() => Promise<string>>()
const writeClipboard = vi.fn<(text: string) => Promise<boolean>>()

function connectBrowser(): FakeRfb {
  render(<BrowserPane />)
  const rfb = rfbState.instances[0]

  act(() => rfb.dispatchEvent(new Event('connect')))

  return rfb
}

describe('BrowserPane clipboard bridge', () => {
  beforeEach(() => {
    rfbState.instances.length = 0
    localStorage.clear()
    localStorage.setItem('optimus.browser.vncPassword', 'test-only')
    readClipboard.mockReset()
    readClipboard.mockResolvedValue('https://example.com/from-local')
    writeClipboard.mockReset()
    writeClipboard.mockResolvedValue(true)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { readClipboard, writeClipboard }
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  it('pastes the local clipboard into the focused remote browser', async () => {
    const rfb = connectBrowser()

    fireEvent.click(screen.getByRole('button', { name: 'Paste clipboard into browser' }))

    await waitFor(() => expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith('https://example.com/from-local'))
    expect(rfb.sendKey.mock.calls).toEqual([
      [0xffe3, 'ControlLeft', true],
      [0x76, 'KeyV', true],
      [0x76, 'KeyV', false],
      [0xffe3, 'ControlLeft', false]
    ])
  })

  it('copies the current remote selection into the local clipboard', async () => {
    const rfb = connectBrowser()

    fireEvent.click(screen.getByRole('button', { name: 'Copy selection from browser' }))
    expect(rfb.sendKey.mock.calls).toEqual([
      [0xffe3, 'ControlLeft', true],
      [0x63, 'KeyC', true],
      [0x63, 'KeyC', false],
      [0xffe3, 'ControlLeft', false]
    ])

    act(() => rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text: 'remote selection' } })))
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith('remote selection'))
  })
})
