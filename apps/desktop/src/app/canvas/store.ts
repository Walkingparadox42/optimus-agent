/**
 * [Optimus Cockpit] Canvas mode — Phase 1 store.
 *
 * The third layout mode: floating, summonable panels over a themed background,
 * replacing the docked rails entirely while it is on. Same additive contract
 * as workspace mode: a single persisted flag, zero effect while off. The
 * canvas layer itself (see ./layer) renders ABOVE the stock shell instead of
 * recomposing it, so none of the protected upstream files change.
 *
 * Canvas mode and workspace mode are mutually exclusive: the docked-rail
 * workspace renders live panes (noVNC browser, voice avatar) that must not
 * keep running hidden underneath the canvas, so turning one mode on turns the
 * other off. Stock mode is the shared substrate under both.
 *
 * Panel layout state (open/rect/z-order + avatar overlay position) is
 * session-scoped by design: it persists across reloads within a window
 * session (sessionStorage) but resets on a fresh launch, per the Phase 1
 * spec. `rect: null` means "auto" — the layer computes the panel's position
 * from the auto-arrange algorithm; a user drag/resize writes a concrete rect
 * and the system respects it until "reset layout".
 */

import { atom } from 'nanostores'

import { Codecs, persistentAtom } from '@/lib/persisted'
import { $workspaceMode, setWorkspaceMode } from '@/store/workspace-mode'

const CANVAS_MODE_STORAGE_KEY = 'hermes.desktop.canvasMode'
const CANVAS_LAYOUT_SESSION_KEY = 'optimus.canvas.layout.v1'

// ─── Mode flag ───────────────────────────────────────────────────────────────

export const $canvasMode = persistentAtom(CANVAS_MODE_STORAGE_KEY, false, Codecs.bool)

export function setCanvasMode(on: boolean): void {
  if (on && $workspaceMode.get()) {
    // One mode at a time — see header comment. Workspace mode's own subscriber
    // swaps the pane scope back to stock.
    setWorkspaceMode(false)
  }

  $canvasMode.set(on)
}

export function toggleCanvasMode(): void {
  setCanvasMode(!$canvasMode.get())
}

// Workspace mode turned on elsewhere (palette, settings) wins over an active
// canvas: drop the canvas rather than stacking both. Guarded so the boot-time
// initial emit only normalizes a genuinely conflicting persisted state.
$workspaceMode.subscribe(on => {
  if (on && $canvasMode.get()) {
    $canvasMode.set(false)
  }
})

// ─── Panel + avatar layout state (session-scoped) ────────────────────────────

export const CANVAS_PANEL_IDS = ['chat', 'botvault', 'browser'] as const
export type CanvasPanelId = (typeof CANVAS_PANEL_IDS)[number]

export interface CanvasRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasPanelState {
  open: boolean
  /** Concrete user-placed rect; null = auto-arranged by the layer. */
  rect: CanvasRect | null
  /** Focus order — higher paints on top. */
  z: number
}

export type CanvasPanelsState = Record<CanvasPanelId, CanvasPanelState>

export interface CanvasAvatarState {
  /** auto = layer keeps it clear of open panels; manual = user-placed. */
  mode: 'auto' | 'manual'
  /** Top-left position while manual; null in auto mode. */
  pos: { x: number; y: number } | null
}

interface CanvasLayoutSnapshot {
  avatar: CanvasAvatarState
  panels: CanvasPanelsState
  zCounter: number
}

// First-entry seed: all three panels summoned, auto-arranged — the mode demos
// itself instead of opening onto an empty background.
const seedPanels = (): CanvasPanelsState => ({
  botvault: { open: true, rect: null, z: 1 },
  browser: { open: true, rect: null, z: 2 },
  chat: { open: true, rect: null, z: 3 }
})

const seedLayout = (): CanvasLayoutSnapshot => ({
  avatar: { mode: 'auto', pos: null },
  panels: seedPanels(),
  zCounter: 3
})

const isPanelId = (value: unknown): value is CanvasPanelId =>
  typeof value === 'string' && (CANVAS_PANEL_IDS as readonly string[]).includes(value)

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const sanitizeRect = (value: unknown): CanvasRect | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const rect = value as Record<string, unknown>

  return isFiniteNumber(rect.x) && isFiniteNumber(rect.y) && isFiniteNumber(rect.w) && isFiniteNumber(rect.h)
    ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
    : null
}

function sanitizeLayout(value: unknown): CanvasLayoutSnapshot {
  const seed = seedLayout()

  if (!value || typeof value !== 'object') {
    return seed
  }

  const raw = value as Record<string, unknown>
  const rawPanels = raw.panels && typeof raw.panels === 'object' ? (raw.panels as Record<string, unknown>) : {}

  for (const [id, entry] of Object.entries(rawPanels)) {
    if (!isPanelId(id) || !entry || typeof entry !== 'object') {
      continue
    }

    const panel = entry as Record<string, unknown>
    seed.panels[id] = {
      open: panel.open === true,
      rect: sanitizeRect(panel.rect),
      z: isFiniteNumber(panel.z) ? panel.z : seed.panels[id].z
    }
  }

  const rawAvatar = raw.avatar && typeof raw.avatar === 'object' ? (raw.avatar as Record<string, unknown>) : {}
  const pos = sanitizeRect({ ...(rawAvatar.pos as object), w: 0, h: 0 })
  seed.avatar =
    rawAvatar.mode === 'manual' && pos ? { mode: 'manual', pos: { x: pos.x, y: pos.y } } : { mode: 'auto', pos: null }

  seed.zCounter = isFiniteNumber(raw.zCounter) ? raw.zCounter : Math.max(...Object.values(seed.panels).map(p => p.z))

  return seed
}

function readSessionLayout(): CanvasLayoutSnapshot {
  try {
    const raw = window.sessionStorage.getItem(CANVAS_LAYOUT_SESSION_KEY)

    return raw ? sanitizeLayout(JSON.parse(raw)) : seedLayout()
  } catch {
    return seedLayout()
  }
}

const initial = typeof window === 'undefined' ? seedLayout() : readSessionLayout()

export const $canvasPanels = atom<CanvasPanelsState>(initial.panels)
export const $canvasAvatar = atom<CanvasAvatarState>(initial.avatar)

let zCounter = initial.zCounter

function persistSessionLayout(): void {
  try {
    window.sessionStorage.setItem(
      CANVAS_LAYOUT_SESSION_KEY,
      JSON.stringify({
        avatar: $canvasAvatar.get(),
        panels: $canvasPanels.get(),
        zCounter
      } satisfies CanvasLayoutSnapshot)
    )
  } catch {
    // Session persistence is best-effort (quota/private mode); the live atoms
    // keep working for the rest of the session.
  }
}

function updatePanel(id: CanvasPanelId, patch: Partial<CanvasPanelState>): void {
  const panels = $canvasPanels.get()
  $canvasPanels.set({ ...panels, [id]: { ...panels[id], ...patch } })
  persistSessionLayout()
}

export function summonPanel(id: CanvasPanelId): void {
  updatePanel(id, { open: true, z: ++zCounter })
}

export function dismissPanel(id: CanvasPanelId): void {
  updatePanel(id, { open: false })
}

export function toggleCanvasPanel(id: CanvasPanelId): void {
  if ($canvasPanels.get()[id].open) {
    dismissPanel(id)
  } else {
    summonPanel(id)
  }
}

/** Raise a panel to the top of the stack (focus/interaction). */
export function focusPanel(id: CanvasPanelId): void {
  if ($canvasPanels.get()[id].z !== zCounter) {
    updatePanel(id, { z: ++zCounter })
  }
}

/** Commit a user drag/resize — the panel now holds its manual placement. */
export function setPanelRect(id: CanvasPanelId, rect: CanvasRect): void {
  updatePanel(id, { rect })
}

/** Back to the auto-arranged default: every panel returns to auto placement. */
export function resetCanvasLayout(): void {
  const panels = $canvasPanels.get()
  const next = {} as CanvasPanelsState

  for (const id of CANVAS_PANEL_IDS) {
    next[id] = { ...panels[id], rect: null }
  }

  $canvasPanels.set(next)
  $canvasAvatar.set({ mode: 'auto', pos: null })
  persistSessionLayout()
}

export function setAvatarManualPos(pos: { x: number; y: number }): void {
  $canvasAvatar.set({ mode: 'manual', pos })
  persistSessionLayout()
}

/** Release the avatar back to auto-positioning. */
export function releaseAvatarToAuto(): void {
  $canvasAvatar.set({ mode: 'auto', pos: null })
  persistSessionLayout()
}
