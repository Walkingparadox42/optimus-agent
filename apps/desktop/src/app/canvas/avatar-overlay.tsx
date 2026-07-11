/**
 * [Optimus Cockpit] Canvas avatar overlay.
 *
 * NOT a panel: a free-positioned plate above the panel layer carrying the
 * existing AvatarPane — which already contains the voice controls and the
 * meeting recorder — unchanged. Only the positioning container is new.
 *
 * Positioning contract (Phase 1 spec):
 *   - auto (default): keeps itself clear of open panels — the layer passes
 *     the live panel rects; we pick the anchor candidate with the least
 *     overlap (ties broken by preference order, bottom-right first).
 *   - manual: a grip-drag pins it wherever the user drops it; the pin button
 *     in the grip releases it back to auto.
 */

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'

import { AvatarPane } from '../avatar'

import { CANVAS_MARGIN, CANVAS_TOP_INSET, type CanvasViewport } from './auto-arrange'
import { type CanvasAvatarState, type CanvasRect, releaseAvatarToAuto, setAvatarManualPos } from './store'

// Fallback footprint before the first ResizeObserver measurement lands.
const DEFAULT_SIZE = { w: 240, h: 380 }
// Clearance above the dock strip at the bottom center.
const DOCK_CLEARANCE = 76

interface AvatarOverlayProps {
  avatar: CanvasAvatarState
  releaseLabel: string
  panelRects: CanvasRect[]
  viewport: CanvasViewport
}

const overlapArea = (a: CanvasRect, b: CanvasRect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)

  return w > 0 && h > 0 ? w * h : 0
}

function autoPosition(viewport: CanvasViewport, panelRects: CanvasRect[], size: { w: number; h: number }) {
  const maxY = viewport.h - size.h - CANVAS_MARGIN - DOCK_CLEARANCE
  const rightX = viewport.w - size.w - CANVAS_MARGIN
  const midY = Math.max(CANVAS_TOP_INSET, Math.round((viewport.h - size.h) / 2))

  // Preference order: bottom-right, top-right, mid-right, bottom-left, top-left.
  const candidates = [
    { x: rightX, y: Math.max(CANVAS_TOP_INSET, maxY) },
    { x: rightX, y: CANVAS_TOP_INSET },
    { x: rightX, y: midY },
    { x: CANVAS_MARGIN, y: Math.max(CANVAS_TOP_INSET, maxY) },
    { x: CANVAS_MARGIN, y: CANVAS_TOP_INSET }
  ]

  let best = candidates[0]
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const rect: CanvasRect = { ...candidate, ...size }
    const score = panelRects.reduce((sum, panel) => sum + overlapArea(rect, panel), 0)

    // Strictly-better only: earlier candidates win ties, keeping the resting
    // spot stable while panels move underneath.
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }

    if (score === 0) {
      break
    }
  }

  return best
}

export function AvatarOverlay({ avatar, panelRects, releaseLabel, viewport }: AvatarOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState(DEFAULT_SIZE)

  // Real footprint for the overlap math — the pane's height varies with the
  // voice/meeting controls inside it.
  useEffect(() => {
    const el = rootRef.current

    if (!el || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect

      if (box && box.width > 0 && box.height > 0) {
        setSize({ w: Math.round(box.width), h: Math.round(box.height) })
      }
    })

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  const autoPos = useMemo(() => autoPosition(viewport, panelRects, size), [panelRects, size, viewport])
  const pos = avatar.mode === 'manual' && avatar.pos ? avatar.pos : autoPos

  const startDrag = useCallback((event: ReactPointerEvent) => {
    const el = rootRef.current

    if (!el || event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return
    }

    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    // Position lives in the transform (so auto-mode moves can transition), so
    // read the current spot from layout, not offsetLeft/Top (always 0 here).
    const box = el.getBoundingClientRect()
    const origin = { x: Math.round(box.left), y: Math.round(box.top) }
    let last = origin

    // The auto-mode reposition transition must not lag the pointer.
    el.style.transition = 'none'

    const onMove = (e: PointerEvent) => {
      last = {
        x: Math.max(0, Math.min(origin.x + (e.clientX - startX), window.innerWidth - 80)),
        y: Math.max(CANVAS_TOP_INSET - 20, Math.min(origin.y + (e.clientY - startY), window.innerHeight - 48))
      }
      el.style.transform = `translate(${last.x}px, ${last.y}px)`
    }

    const finish = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      window.removeEventListener('blur', finish)
      el.style.transition = ''
      setAvatarManualPos(last)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    window.addEventListener('blur', finish)
  }, [])

  return (
    <div
      className="canvas-avatar"
      data-mode={avatar.mode}
      ref={rootRef}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
    >
      <div className="canvas-avatar-frame">
        <div className="canvas-avatar-surface">
          <div className="canvas-avatar-grip" onPointerDown={startDrag}>
            {avatar.mode === 'manual' && (
              <button
                aria-label={releaseLabel}
                className="canvas-panel-button"
                onClick={releaseAvatarToAuto}
                title={releaseLabel}
                type="button"
              >
                <Codicon name="pinned" size={12} />
              </button>
            )}
          </div>
          <div className="canvas-avatar-body">
            {/* Voice controls + meeting recorder ride inside AvatarPane, as in
                workspace mode — ported forward as-is per the Phase 1 spec. */}
            <AvatarPane />
          </div>
        </div>
      </div>
    </div>
  )
}
