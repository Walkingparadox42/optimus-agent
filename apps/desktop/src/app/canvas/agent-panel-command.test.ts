import { describe, expect, it } from 'vitest'

import { OPTIMUS_COCKPIT_PANEL_TOOL, OPTIMUS_UI_COMMAND_EVENT, parseOptimusCockpitPanelCommand } from './agent-panel-command'

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

  it('ignores unrelated tools and invalid panels', () => {
    expect(parseOptimusCockpitPanelCommand('tool.start', { args: { action: 'open', panel: 'chat' }, name: 'other' })).toBeNull()
    expect(parseOptimusCockpitPanelCommand(OPTIMUS_UI_COMMAND_EVENT, { action: 'open', panel: 'terminal' })).toBeNull()
  })
})

