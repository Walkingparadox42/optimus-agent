import { afterEach, describe, expect, it } from 'vitest'

import { $revealInTreeRequest } from '@/store/layout'

import {
  applyOptimusCockpitPanelCommand,
  OPTIMUS_COCKPIT_PANEL_TOOL,
  OPTIMUS_UI_COMMAND_EVENT,
  parseOptimusCockpitPanelCommand,
  resolveVaultPath
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

  // Hermes prefixes MCP tools as mcp_{server}_{tool} (tools/mcp_tool.py), so
  // the live event never carries the bare name — every registration variant
  // must parse, or agent panel commands silently do nothing.
  it('accepts the live mcp_-prefixed composite tool names', () => {
    const args = { action: 'open', panel: 'chat' }

    expect(
      parseOptimusCockpitPanelCommand('tool.start', { args, name: 'mcp_optimus_browser_optimus_cockpit_panel' })
    ).toEqual({ action: 'open', panel: 'chat' })

    expect(parseOptimusCockpitPanelCommand('tool.start', { args, name: 'mcp_optimus_cockpit_panel_panel' })).toEqual({
      action: 'open',
      panel: 'chat'
    })

    // Voice event shape carries `tool` instead of `name`.
    expect(
      parseOptimusCockpitPanelCommand('tool.start', { args, tool: 'mcp_optimus_browser_optimus_cockpit_panel' })
    ).toEqual({ action: 'open', panel: 'chat' })
  })

  // The 2026-07-12 live bug, pinned: the gateway's tool.start payload is
  // {tool_id, name, context} with NO args (tui_gateway _on_tool_start), so a
  // start-shaped payload must parse to null — commands apply on tool.complete,
  // which carries {tool_id, name, args}.
  it('gateway tool.start (argless) yields null; tool.complete (with args) parses', () => {
    const name = 'mcp_optimus_browser_optimus_cockpit_panel'

    expect(
      parseOptimusCockpitPanelCommand('tool.start', { context: 'optimus_cockpit_panel', name, tool_id: 'c1' })
    ).toBeNull()

    // Exact live payload observed on CT119 (url null, relative vault path).
    expect(
      parseOptimusCockpitPanelCommand('tool.complete', {
        args: { action: 'open', panel: 'botvault', path: 'Optimus/SCHEMA.md', url: null },
        name,
        tool_id: 'c1'
      })
    ).toEqual({ action: 'open', panel: 'botvault', path: 'Optimus/SCHEMA.md' })
  })

  it('still accepts the legacy bare tool name and rejects near-misses', () => {
    const args = { action: 'toggle', panel: 'browser' }

    expect(parseOptimusCockpitPanelCommand('tool.start', { args, name: 'optimus_cockpit_panel' })).toEqual({
      action: 'toggle',
      panel: 'browser'
    })

    // Not mcp_-prefixed and not the bare name — never a panel command.
    expect(parseOptimusCockpitPanelCommand('tool.start', { args, name: 'optimus_cockpit_panel_extra' })).toBeNull()
    expect(parseOptimusCockpitPanelCommand('tool.start', { args, name: 'other_optimus_cockpit_panel' })).toBeNull()
  })
})

describe('applyOptimusCockpitPanelCommand', () => {
  afterEach(() => {
    $canvasMode.set(false)
    $revealInTreeRequest.set(null)
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

  it('reveals an opened BotVault note in the folder tree', () => {
    $canvasMode.set(true)

    applyOptimusCockpitPanelCommand({ action: 'open', panel: 'botvault', path: 'Optimus/SCHEMA.md' })

    expect($revealInTreeRequest.get()).toBe('/mnt/vaults/BotVault/Optimus/SCHEMA.md')
  })
})

describe('resolveVaultPath', () => {
  const VAULT = '/mnt/vaults/BotVault'

  it('resolves the live relative shape against the vault root', () => {
    expect(resolveVaultPath('Optimus/SCHEMA.md')).toBe(`${VAULT}/Optimus/SCHEMA.md`)
    expect(resolveVaultPath('./Optimus/SCHEMA.md')).toBe(`${VAULT}/Optimus/SCHEMA.md`)
  })

  it('passes through absolute vault-rooted paths and normalizes backslashes', () => {
    expect(resolveVaultPath(`${VAULT}/notes/a.md`)).toBe(`${VAULT}/notes/a.md`)
    expect(resolveVaultPath('Optimus\\SCHEMA.md')).toBe(`${VAULT}/Optimus/SCHEMA.md`)
  })

  it('rejects paths that land outside the vault', () => {
    expect(resolveVaultPath('/etc/passwd')).toBeNull()
    expect(resolveVaultPath('../../etc/passwd')).toBeNull()
    expect(resolveVaultPath('Optimus/../../../etc/passwd')).toBeNull()
    expect(resolveVaultPath('')).toBeNull()
  })

  it('resolves internal dot segments without escaping', () => {
    expect(resolveVaultPath('Optimus/sub/../SCHEMA.md')).toBe(`${VAULT}/Optimus/SCHEMA.md`)
  })
})
