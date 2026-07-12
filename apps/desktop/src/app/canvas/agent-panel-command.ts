import { translateNow } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { notify } from '@/store/notifications'
import { setCurrentSessionPreviewTarget } from '@/store/preview'

import { BOTVAULT_PATH } from '../botvault/use-vault-tree'

import { $canvasMode, type CanvasPanelId, dismissPanel, summonPanel, toggleCanvasPanel } from './store'

export const OPTIMUS_COCKPIT_PANEL_TOOL = 'optimus_cockpit_panel'
export const OPTIMUS_UI_COMMAND_EVENT = 'optimus.ui.command'

export interface OptimusCockpitPanelCommand {
  action: 'close' | 'open' | 'toggle'
  panel: CanvasPanelId
  path?: string
  url?: string
}

const PANEL_IDS = new Set<CanvasPanelId>(['botvault', 'browser', 'chat'])
const ACTIONS = new Set<OptimusCockpitPanelCommand['action']>(['close', 'open', 'toggle'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function toolArgs(payload: Record<string, unknown>): unknown {
  const args = payload.args ?? payload.arguments ?? payload.input ?? payload.payload

  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as unknown
    } catch {
      return {}
    }
  }

  return args
}

export function parseOptimusCockpitPanelCommand(eventType: string, payload: unknown): OptimusCockpitPanelCommand | null {
  const record = asRecord(payload)
  const toolName = record.name ?? record.tool

  const source =
    eventType === OPTIMUS_UI_COMMAND_EVENT
      ? record
      : toolName === OPTIMUS_COCKPIT_PANEL_TOOL
        ? asRecord(toolArgs(record))
        : {}

  const action = source.action
  const panel = source.panel

  if (!ACTIONS.has(action as OptimusCockpitPanelCommand['action']) || !PANEL_IDS.has(panel as CanvasPanelId)) {
    return null
  }

  const url = typeof source.url === 'string' && source.url.trim() ? source.url.trim() : undefined
  const rawPath = source.path ?? source.file ?? source.note ?? (panel === 'botvault' ? source.url : undefined)
  const path = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : undefined

  return { action: action as OptimusCockpitPanelCommand['action'], panel: panel as CanvasPanelId, path, url }
}

function isVaultPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')

  return normalized === BOTVAULT_PATH || normalized.startsWith(`${BOTVAULT_PATH}/`)
}

async function openBotVaultPath(path: string): Promise<void> {
  if (!isVaultPath(path)) {
    return
  }

  const target = await normalizeOrLocalPreviewTarget(path, BOTVAULT_PATH)

  if (target) {
    setCurrentSessionPreviewTarget(target, 'file-browser', path)
  }
}

export function applyOptimusCockpitPanelCommand(command: OptimusCockpitPanelCommand): void {
  // Panel commands act only while canvas mode is ALREADY on (Steve,
  // 2026-07-12, option (a)): an agent call must never silently switch the
  // user's layout mode. Outside canvas it no-ops with a visible toast so the
  // attempted command isn't just swallowed.
  if (!$canvasMode.get()) {
    notify({
      kind: 'info',
      message: translateNow('canvas.agentCommandIgnoredBody'),
      title: translateNow('canvas.agentCommandIgnoredTitle')
    })

    return
  }

  if (command.action === 'close') {
    dismissPanel(command.panel)

    return
  }

  if (command.action === 'open') {
    summonPanel(command.panel)
  } else {
    toggleCanvasPanel(command.panel)
  }

  if (command.panel === 'botvault' && command.path) {
    void openBotVaultPath(command.path)
  }

  // panel === 'browser' + url: nothing to do here — the CT119
  // optimus_cockpit_panel tool chains the shared browser's navigate verb
  // itself, so by the time this event reaches the renderer the page load is
  // already underway. The renderer only summons the pane.
}
