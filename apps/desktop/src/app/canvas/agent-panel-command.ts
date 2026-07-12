import { translateNow } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { notify } from '@/store/notifications'
import { setCurrentSessionPreviewTarget } from '@/store/preview'

import { BOTVAULT_PATH } from '../botvault/use-vault-tree'

import { $canvasMode, type CanvasPanelId, dismissPanel, summonPanel, toggleCanvasPanel } from './store'

export const OPTIMUS_COCKPIT_PANEL_TOOL = 'optimus_cockpit_panel'
export const OPTIMUS_UI_COMMAND_EVENT = 'optimus.ui.command'

// Build-currency breadcrumb: fires once when this module loads. If this line
// is missing from the console after a window reload, the renderer is NOT
// running the current tree — check that before debugging anything downstream.
console.info('[cockpit-panel] listener module loaded (tool.complete channel, 2026-07-12)')

/**
 * Diagnostic for the silent-miss case: an event that LOOKS cockpit-related
 * (name/tool mentions optimus/cockpit) but failed to parse. Logs the whole
 * payload so a name or argument-shape mismatch is visible in devtools instead
 * of vanishing. Quiet for all unrelated tools.
 */
export function logUnparsedCockpitCandidate(eventType: string, payload: unknown): void {
  const record = asRecord(payload)
  const name = String(record.name ?? record.tool ?? '')

  if (/cockpit|optimus/i.test(name)) {
    console.warn('[cockpit-panel] candidate event did NOT parse — name/shape mismatch:', eventType, payload)
  }
}

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

/**
 * True for every name the cockpit-panel tool can arrive under. Hermes exposes
 * MCP tools as `mcp_{sanitized_server}_{sanitized_tool}` (vendor
 * tools/mcp_tool.py), so the LIVE name is a composite like
 * `mcp_optimus_browser_optimus_cockpit_panel` — and the server key half is
 * deployment config, not ours to assume. Accept the bare tool name (voice
 * service / direct emits) and any `mcp_`-prefixed composite containing it.
 */
function isCockpitPanelToolName(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false
  }

  const normalized = name.toLowerCase()

  return (
    normalized === OPTIMUS_COCKPIT_PANEL_TOOL ||
    (normalized.startsWith('mcp_') && normalized.includes(OPTIMUS_COCKPIT_PANEL_TOOL)) ||
    // Observed live shape on CT115 (Steve, 2026-07-12) — the sanitized
    // composite can also land with the tool name split around the server key.
    normalized === 'mcp_optimus_cockpit_panel_panel'
  )
}

export function parseOptimusCockpitPanelCommand(eventType: string, payload: unknown): OptimusCockpitPanelCommand | null {
  const record = asRecord(payload)
  const toolName = record.name ?? record.tool

  const source =
    eventType === OPTIMUS_UI_COMMAND_EVENT
      ? record
      : isCockpitPanelToolName(toolName)
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

/**
 * Resolve an agent-supplied note path to an absolute vault path, or null when
 * it can't land inside the vault. The live tool call carries whatever the
 * agent typed — observed on CT119: `path: 'Optimus/SCHEMA.md'`, relative, no
 * vault root — so relative paths resolve against the vault root instead of
 * being silently dropped (the second half of the 2026-07-12 live bug).
 * Dot segments are resolved first, so `a/../../etc` can't traverse out.
 */
export function resolveVaultPath(raw: string): string | null {
  const normalized = raw.trim().replaceAll('\\', '/')

  if (!normalized) {
    return null
  }

  const base = normalized.startsWith('/') ? normalized : `${BOTVAULT_PATH}/${normalized}`
  const segments: string[] = []

  for (const part of base.split('/')) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      segments.pop()

      continue
    }

    segments.push(part)
  }

  const resolved = `/${segments.join('/')}`

  return resolved === BOTVAULT_PATH || resolved.startsWith(`${BOTVAULT_PATH}/`) ? resolved : null
}

async function openBotVaultPath(rawPath: string): Promise<void> {
  const path = resolveVaultPath(rawPath)

  if (!path) {
    // Loud, greppable rejection — a dropped note path was invisible before.
    console.warn('[cockpit-panel] note path rejected (outside vault):', rawPath)

    return
  }

  const target = await normalizeOrLocalPreviewTarget(path, BOTVAULT_PATH)

  if (target) {
    setCurrentSessionPreviewTarget(target, 'file-browser', path)
  } else {
    console.warn('[cockpit-panel] note path did not resolve to a preview target:', path)
  }
}

export function applyOptimusCockpitPanelCommand(command: OptimusCockpitPanelCommand): void {
  // Permanent breadcrumb: every applied (or gated) command is visible in
  // devtools, so "the agent said it opened X and nothing happened" is
  // diagnosable from the console instead of re-instrumenting each time.
  console.info('[cockpit-panel] command', command, $canvasMode.get() ? '(canvas on)' : '(canvas OFF, ignored)')

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
