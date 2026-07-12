import { afterEach, describe, expect, it } from 'vitest'

import {
  applyOptimusCockpitPanelCommand,
  OPTIMUS_COCKPIT_PANEL_TOOL,
  OPTIMUS_UI_COMMAND_EVENT,
  parseOptimusCockpitPanelCommand
} from './agent-panel-command'
import { $canvasMode, $canvasPanels, dismissPanel } from './store'

describe('Optimus cockpit panel command parser', () => {
  it('accepts direct renderer events', () => {
    expect(parseOptimusCockpitPanelCommand(OPTIMUS_UI_COMMAND_EVENT, { action: 'open', panel: 'browser' })).toEqual({
      action: 'open',
      panel: 'browser'
    })
  })

  it('accepts the stable MCP tool payload shape', () => {
    expect(
      parseOptimusCockpitPanelCommand('tool.start', {
        args: { action: 'toggle', panel: 'botvault' },
        name: OPTIMUS_COCKPIT_PANEL_TOOL
      })
    ).toEqual({ action: 'toggle', panel: 'botvault' })
  })

  it('parses JSON string tool args and preserves browser URLs', () => {
    expect(
      parseOptimusCockpitPanelCommand('tool.start', {
        args: '{"action":"open","panel":"browser","url":"https://example.com"}',
        name: OPTIMUS_COCKPIT_PANEL_TOOL
      })
    ).toEqual({ action: 'open', panel: 'browser', url: 'https://example.com' })
  })

  it('accepts BotVault paths for note navigation', () => {
    expect(
      parseOptimusCockpitPanelCommand('tool.start', {
        args: { action: 'open', panel: 'botvault', path: '/mnt/vaults/BotVault/00-inbox/report.md' },
        name: OPTIMUS_COCKPIT_PANEL_TOOL
      })
    ).toEqual({ action: 'open', panel: 'botvault', path: '/mnt/vaults/BotVault/00-inbox/report.md' })
  })

  it('ignores unrelated tools and invalid panels', () => {
    expect(parseOptimusCockpitPanelCommand('tool.start', { args: { action: 'open', panel: 'chat' }, name: 'other' })).toBeNull()
    expect(parseOptimusCockpitPanelCommand(OPTIMUS_UI_COMMAND_EVENT, { action: 'open', panel: 'terminal' })).toBeNull()
  })
})

describe('applyOptimusCockpitPanelCommand', () => {
  afterEach(() => {
    $canvasMode.set(false)
  })

  it('no-ops when canvas mode is off — never a silent layout switch', () => {
    $canvasMode.set(false)
    dismissPanel('chat')

    applyOptimusCockpitPanelCommand({ action: 'open', panel: 'chat' })

    expect($canvasMode.get()).toBe(false)
    expect($canvasPanels.get().chat.open).toBe(false)
  })

  it('opens and closes panels while canvas mode is on', () => {
    $canvasMode.set(true)
    dismissPanel('chat')

    applyOptimusCockpitPanelCommand({ action: 'open', panel: 'chat' })
    expect($canvasPanels.get().chat.open).toBe(true)

    applyOptimusCockpitPanelCommand({ action: 'close', panel: 'chat' })
    expect($canvasPanels.get().chat.open).toBe(false)
  })

  it('toggle flips exactly once per applied command', () => {
    $canvasMode.set(true)
    dismissPanel('browser')

    applyOptimusCockpitPanelCommand({ action: 'toggle', panel: 'browser' })
    expect($canvasPanels.get().browser.open).toBe(true)

    applyOptimusCockpitPanelCommand({ action: 'toggle', panel: 'browser' })
    expect($canvasPanels.get().browser.open).toBe(false)
  })
})
