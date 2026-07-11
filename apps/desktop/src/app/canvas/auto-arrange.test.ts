import { describe, expect, it } from 'vitest'

import { autoArrangeRects, CANVAS_MARGIN, CANVAS_TOP_INSET, clampRectToViewport } from './auto-arrange'
import type { CanvasPanelId, CanvasRect } from './store'

const VIEWPORT = { w: 1600, h: 900 }
const ALL: CanvasPanelId[] = ['chat', 'botvault', 'browser']

const overlaps = (a: CanvasRect, b: CanvasRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('autoArrangeRects', () => {
  it('lays out all three panels without overlap on a normal viewport', () => {
    const rects = Object.values(autoArrangeRects(VIEWPORT, ALL)) as CanvasRect[]

    expect(rects).toHaveLength(3)

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false)
      }
    }
  })

  it('keeps panels inside the top inset and side margins', () => {
    const rects = Object.values(autoArrangeRects(VIEWPORT, ALL)) as CanvasRect[]

    for (const rect of rects) {
      expect(rect.y).toBeGreaterThanOrEqual(CANVAS_TOP_INSET)
      expect(rect.x).toBeGreaterThanOrEqual(CANVAS_MARGIN)
      expect(rect.x + rect.w).toBeLessThanOrEqual(VIEWPORT.w - CANVAS_MARGIN + 1)
    }
  })

  it('arranges any subset without overlap and skips closed panels', () => {
    const rects = autoArrangeRects(VIEWPORT, ['chat', 'browser'])

    expect(rects.botvault).toBeUndefined()
    expect(rects.chat).toBeDefined()
    expect(rects.browser).toBeDefined()
    expect(overlaps(rects.chat!, rects.browser!)).toBe(false)
  })

  it('returns nothing when no panels are open', () => {
    expect(autoArrangeRects(VIEWPORT, [])).toEqual({})
  })

  it('never collapses a panel below its minimum on a tiny viewport', () => {
    const rects = autoArrangeRects({ w: 700, h: 500 }, ALL)

    expect(rects.chat!.w).toBeGreaterThanOrEqual(360)
    expect(rects.botvault!.w).toBeGreaterThanOrEqual(236)
    expect(rects.browser!.w).toBeGreaterThanOrEqual(380)
  })
})

describe('clampRectToViewport', () => {
  it('keeps a dragged-out panel reachable', () => {
    const clamped = clampRectToViewport({ x: 5000, y: 5000, w: 400, h: 300 }, VIEWPORT)

    expect(clamped.x).toBeLessThanOrEqual(VIEWPORT.w - 120)
    expect(clamped.y).toBeLessThanOrEqual(VIEWPORT.h - 48)
  })

  it('never lets the header escape above the canvas top', () => {
    const clamped = clampRectToViewport({ x: 100, y: -400, w: 400, h: 300 }, VIEWPORT)

    expect(clamped.y).toBeGreaterThanOrEqual(CANVAS_TOP_INSET - 20)
  })
})
