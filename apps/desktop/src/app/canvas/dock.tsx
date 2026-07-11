/**
 * [Optimus Cockpit] Canvas dock — the summon surface.
 *
 * A slim machined strip at the bottom center: one toggle per panel (lit tick
 * = open), reset-to-auto-arrange, and the exit back to the classic layout.
 * Dismissed panels come back from here (or the command palette).
 */

import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'

import { CANVAS_PANEL_IDS, type CanvasPanelId, type CanvasPanelsState, resetCanvasLayout, setCanvasMode, toggleCanvasPanel } from './store'

const PANEL_ICONS: Record<CanvasPanelId, string> = {
  botvault: 'database',
  browser: 'globe',
  chat: 'comment-discussion'
}

export function CanvasDock({ panels }: { panels: CanvasPanelsState }) {
  const { t } = useI18n()
  const c = t.canvas

  return (
    <nav aria-label={c.dockAria} className="canvas-dock">
      {CANVAS_PANEL_IDS.map(id => (
        <button
          aria-label={c.panels[id]}
          aria-pressed={panels[id].open}
          className="canvas-dock-button"
          data-active={panels[id].open ? '' : undefined}
          key={id}
          onClick={() => toggleCanvasPanel(id)}
          title={c.panels[id]}
          type="button"
        >
          <Codicon name={PANEL_ICONS[id]} size={16} />
        </button>
      ))}

      <span aria-hidden className="canvas-dock-divider" />

      <button
        aria-label={c.resetLayout}
        className="canvas-dock-button"
        onClick={resetCanvasLayout}
        title={c.resetLayout}
        type="button"
      >
        <Codicon name="layout" size={16} />
      </button>

      <button
        aria-label={c.exitCanvas}
        className="canvas-dock-button"
        onClick={() => setCanvasMode(false)}
        title={c.exitCanvas}
        type="button"
      >
        <Codicon name="multiple-windows" size={16} />
      </button>
    </nav>
  )
}
