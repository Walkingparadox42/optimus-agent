/**
 * [Optimus Cockpit] Canvas mode — auto-arrange.
 *
 * Pure geometry for the default panel arrangement: given the viewport and the
 * set of open panels, produce a non-overlapping, content-sized layout. This is
 * a starting layout and a reset target, never an ongoing constraint — the
 * layer only applies these rects to panels whose stored rect is null (auto).
 *
 * The composition is deliberately "floating", not tiled: each panel has its
 * own height fraction and vertical bias so the group reads as plates hovering
 * over the canvas rather than a docked grid.
 */

import type { CanvasPanelId, CanvasRect } from './store'

export interface CanvasViewport {
  w: number
  h: number
}

// Clearance for the titlebar band (34px) plus breathing room; the canvas is
// calm and spacious by design, so margins err generous.
export const CANVAS_TOP_INSET = 56
export const CANVAS_MARGIN = 28
const GAP = 24

interface PanelSpec {
  /** Share of available width relative to the other open panels. */
  weight: number
  minW: number
  maxW: number
  /** Fraction of available height. */
  vh: number
  /** Vertical bias inside the leftover space: 0 = top, 0.5 = centered, 1 = bottom. */
  dy: number
}

// Chat and browser need room; BotVault now carries a live note preview in
// canvas mode, so it gets enough width to split tree + content when possible.
const SPECS: Record<CanvasPanelId, PanelSpec> = {
  chat: { weight: 36, minW: 360, maxW: 820, vh: 1, dy: 0 },
  botvault: { weight: 28, minW: 380, maxW: 620, vh: 0.78, dy: 0.34 },
  browser: { weight: 36, minW: 380, maxW: 1180, vh: 0.9, dy: 0.16 }
}

const ORDER: readonly CanvasPanelId[] = ['chat', 'botvault', 'browser']

export function autoArrangeRects(
  viewport: CanvasViewport,
  openIds: readonly CanvasPanelId[]
): Partial<Record<CanvasPanelId, CanvasRect>> {
  const open = ORDER.filter(id => openIds.includes(id))

  if (open.length === 0) {
    return {}
  }

  const availH = Math.max(240, viewport.h - CANVAS_TOP_INSET - CANVAS_MARGIN)
  const availW = Math.max(320, viewport.w - CANVAS_MARGIN * 2 - GAP * (open.length - 1))
  const totalWeight = open.reduce((sum, id) => sum + SPECS[id].weight, 0)

  // Weight share clamped to per-panel min/max; if the clamped sum still
  // overflows, scale everything down toward the mins (never below — a tiny
  // window overflows right rather than crushing panels unusable).
  const widths = new Map<CanvasPanelId, number>()

  for (const id of open) {
    const spec = SPECS[id]
    widths.set(id, Math.round(Math.min(spec.maxW, Math.max(spec.minW, (spec.weight / totalWeight) * availW))))
  }

  const sum = [...widths.values()].reduce((a, b) => a + b, 0)

  if (sum > availW) {
    const shrinkable = open.reduce((acc, id) => acc + (widths.get(id)! - SPECS[id].minW), 0)
    const overflow = sum - availW

    if (shrinkable > 0) {
      const ratio = Math.min(1, overflow / shrinkable)

      for (const id of open) {
        const w = widths.get(id)!
        widths.set(id, Math.round(w - (w - SPECS[id].minW) * ratio))
      }
    }
  }

  const totalW = [...widths.values()].reduce((a, b) => a + b, 0) + GAP * (open.length - 1)
  let x = Math.max(CANVAS_MARGIN, Math.round((viewport.w - totalW) / 2))

  const rects: Partial<Record<CanvasPanelId, CanvasRect>> = {}

  for (const id of open) {
    const spec = SPECS[id]
    const w = widths.get(id)!
    const h = Math.round(availH * spec.vh)
    const y = Math.round(CANVAS_TOP_INSET + (availH - h) * spec.dy)

    rects[id] = { x, y, w, h }
    x += w + GAP
  }

  return rects
}

/** Keep a dragged/resized rect reachable: its header stays inside the viewport. */
export function clampRectToViewport(rect: CanvasRect, viewport: CanvasViewport): CanvasRect {
  const minVisible = 120

  return {
    ...rect,
    x: Math.min(Math.max(rect.x, minVisible - rect.w), viewport.w - minVisible),
    y: Math.min(Math.max(rect.y, CANVAS_TOP_INSET - 20), viewport.h - 48)
  }
}
