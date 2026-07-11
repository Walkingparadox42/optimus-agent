/**
 * [Optimus Cockpit] Canvas floating panel wrapper.
 *
 * The machined-plate container every canvas surface lives in: title band
 * (drag handle + dismiss), chamfered frame, resize handles, focus z-order,
 * and the deploy/stow animation lifecycle. Contents are existing components
 * passed as children — this wrapper owns only the shell.
 *
 * Drag/resize write to the DOM directly during the gesture (no store traffic
 * at pointermove rate) and commit once on release, which both keeps 60fps and
 * marks the panel as manually placed exactly once.
 */

import {
  type AnimationEvent as ReactAnimationEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { Codicon } from '@/components/ui/codicon'

import { CANVAS_TOP_INSET, clampRectToViewport } from './auto-arrange'
import { type CanvasPanelId, type CanvasRect, dismissPanel, focusPanel, setPanelRect } from './store'

type PanelStage = 'dismissing' | 'open' | 'summoning'
type ResizeDir = 'e' | 's' | 'se'

interface CanvasPanelProps {
  children: ReactNode
  closeLabel: string
  focused: boolean
  icon: string
  id: CanvasPanelId
  minHeight?: number
  minWidth?: number
  /** True while the panel should be visible; flipping to false plays the refold, then onStowed fires. */
  open: boolean
  /** Called after the dismiss animation completes so the layer can unmount. */
  onStowed: (id: CanvasPanelId) => void
  rect: CanvasRect
  title: string
  z: number
}

export function CanvasPanel({
  children,
  closeLabel,
  focused,
  icon,
  id,
  minHeight = 160,
  minWidth = 240,
  open,
  onStowed,
  rect,
  title,
  z
}: CanvasPanelProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const [stage, setStage] = useState<PanelStage>('summoning')

  // open -> false starts the refold; unmount happens when the animation ends
  // (with a timer fallback in case animation events are swallowed).
  useEffect(() => {
    if (open) {
      return
    }

    setStage('dismissing')
    const fallback = window.setTimeout(() => onStowed(id), 600)

    return () => window.clearTimeout(fallback)
  }, [id, onStowed, open])

  // Keyed on animationName: content animations (pulses, spinners) bubble up
  // from children and must not end the deploy/stow stages early.
  const onAnimationEnd = useCallback(
    (event: ReactAnimationEvent) => {
      if (event.animationName === 'canvas-unfold' && stage === 'summoning') {
        setStage('open')
      } else if (event.animationName === 'canvas-refold' && stage === 'dismissing') {
        onStowed(id)
      }
    },
    [id, onStowed, stage]
  )

  // Shared gesture runner: applies px deltas to a starting rect, paints them
  // straight onto the element, commits to the store on release.
  const runGesture = useCallback(
    (event: ReactPointerEvent, apply: (start: CanvasRect, dx: number, dy: number) => CanvasRect) => {
      const el = rootRef.current

      if (!el || event.button !== 0) {
        return
      }

      event.preventDefault()
      focusPanel(id)

      const startX = event.clientX
      const startY = event.clientY

      const start: CanvasRect = {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight
      }

      let last = start

      const paint = (next: CanvasRect) => {
        last = next
        el.style.left = `${next.x}px`
        el.style.top = `${next.y}px`
        el.style.width = `${next.w}px`
        el.style.height = `${next.h}px`
      }

      const onMove = (e: PointerEvent) => paint(apply(start, e.clientX - startX, e.clientY - startY))

      const finish = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', finish, true)
        window.removeEventListener('pointercancel', finish, true)
        window.removeEventListener('blur', finish)
        setPanelRect(id, clampRectToViewport(last, { w: window.innerWidth, h: window.innerHeight }))
      }

      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', finish, true)
      window.addEventListener('pointercancel', finish, true)
      window.addEventListener('blur', finish)
    },
    [id]
  )

  const startDrag = useCallback(
    (event: ReactPointerEvent) => {
      // Buttons on the title band (dismiss) handle their own clicks.
      if ((event.target as HTMLElement).closest('button')) {
        return
      }

      runGesture(event, (start, dx, dy) => ({
        ...start,
        x: start.x + dx,
        y: Math.max(CANVAS_TOP_INSET - 20, start.y + dy)
      }))
    },
    [runGesture]
  )

  const startResize = useCallback(
    (event: ReactPointerEvent, dir: ResizeDir) => {
      event.stopPropagation()
      runGesture(event, (start, dx, dy) => ({
        ...start,
        w: dir === 's' ? start.w : Math.max(minWidth, start.w + dx),
        h: dir === 'e' ? start.h : Math.max(minHeight, start.h + dy)
      }))
    },
    [minHeight, minWidth, runGesture]
  )

  return (
    <section
      aria-label={title}
      className="canvas-panel"
      data-canvas-panel={id}
      data-focused={focused ? '' : undefined}
      data-state={stage}
      onAnimationEnd={onAnimationEnd}
      onPointerDownCapture={() => focusPanel(id)}
      ref={rootRef}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z }}
    >
      <div className="canvas-panel-frame">
        <div className="canvas-panel-surface">
          <header className="canvas-panel-title" onPointerDown={startDrag}>
            <span className="canvas-panel-title-tick" />
            <Codicon name={icon} size={13} />
            <span className="canvas-panel-title-label">{title}</span>
            <button
              aria-label={closeLabel}
              className="canvas-panel-button"
              data-danger=""
              onClick={() => dismissPanel(id)}
              title={closeLabel}
              type="button"
            >
              <Codicon name="chrome-close" size={13} />
            </button>
          </header>
          <div className="canvas-panel-body">{children}</div>
        </div>
      </div>

      <div className="canvas-resize" data-dir="e" onPointerDown={e => startResize(e, 'e')} />
      <div className="canvas-resize" data-dir="s" onPointerDown={e => startResize(e, 's')} />
      <div className="canvas-resize" data-dir="se" onPointerDown={e => startResize(e, 'se')} />
    </section>
  )
}
