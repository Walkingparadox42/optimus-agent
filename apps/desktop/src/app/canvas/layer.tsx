/**
 * [Optimus Cockpit] Canvas mode layer — the floating-panel workspace.
 *
 * A parallel layout container, NOT a change to the stock shell: a fixed,
 * opaque, themed layer at z-10 that covers the docked layout (main is z-3)
 * while staying under the fixed titlebar controls (z-70) and every overlay
 * (z-50+) — settings, command palette, session switcher, and notifications
 * keep working above it. Flipping $canvasMode off unmounts this layer and the
 * stock/workspace UI underneath is untouched.
 *
 * Panel contents are the existing components:
 *   chat     — the live ChatView DOM, re-parented via the chat-host portal
 *              (all wiring stays in DesktopController; see ./chat-host)
 *   botvault — <BotVaultPane>, same composer-insert affordances as workspace
 *   browser  — <BrowserPane> (noVNC into CT119), mounted only while open so
 *              dismissing tears the RFB client down, like the docked pane
 *   avatar   — <AvatarPane> inside the free-positioned overlay (voice +
 *              meeting recorder ride inside it, unchanged)
 */

import './canvas.css'

import { useStore } from '@nanostores/react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { $activeGatewayProfile } from '@/store/profile'
import { $currentCwd } from '@/store/session'

import { BotVaultPane } from '../botvault'
import { BrowserPane } from '../browser'
import { requestComposerFocus, requestComposerInsertRefs } from '../chat/composer/focus'
import { droppedFileInlineRef } from '../chat/composer/inline-refs'

import { autoArrangeRects, type CanvasViewport } from './auto-arrange'
import { AvatarOverlay } from './avatar-overlay'
import { setCanvasChatHost } from './chat-host'
import { CanvasDock } from './dock'
import { CanvasPanel } from './panel'
import {
  $canvasAvatar,
  $canvasPanels,
  CANVAS_PANEL_IDS,
  type CanvasPanelId,
  type CanvasRect
} from './store'
import { canvasThemeForProfile, toCssVars } from './themes'

const PANEL_ICONS: Record<CanvasPanelId, string> = {
  botvault: 'database',
  browser: 'globe',
  chat: 'comment-discussion'
}

// Minimum sizes per content (BotVault is tree + live note preview in canvas).
const PANEL_MIN: Record<CanvasPanelId, { w: number; h: number }> = {
  botvault: { w: 380, h: 300 },
  browser: { w: 360, h: 280 },
  chat: { w: 340, h: 320 }
}

function useViewport(): CanvasViewport {
  const [viewport, setViewport] = useState<CanvasViewport>(() => ({
    w: window.innerWidth,
    h: window.innerHeight
  }))

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })

    window.addEventListener('resize', onResize)

    return () => window.removeEventListener('resize', onResize)
  }, [])

  return viewport
}

/** Vault tree activation -> composer inline ref, matching the docked pane's behavior. */
function insertVaultRef(path: string, isDirectory: boolean): void {
  const ref = droppedFileInlineRef({ isDirectory, path }, $currentCwd.get())

  if (ref) {
    requestComposerInsertRefs([ref])
    requestComposerFocus('main')
  }
}

export function CanvasLayer() {
  const { t } = useI18n()
  const panels = useStore($canvasPanels)
  const avatar = useStore($canvasAvatar)
  const profile = useStore($activeGatewayProfile)
  const viewport = useViewport()

  const theme = useMemo(() => canvasThemeForProfile(profile), [profile])
  const themeVars = useMemo(() => toCssVars(theme), [theme])

  // Dismissed panels stay mounted through their refold animation; the panel
  // calls onStowed when it finishes and only then unmounts (which is also what
  // tears down live content like the browser's RFB client).
  const [closingIds, setClosingIds] = useState<readonly CanvasPanelId[]>([])
  const prevOpenRef = useRef<Record<CanvasPanelId, boolean> | null>(null)

  useEffect(() => {
    const prev = prevOpenRef.current

    for (const id of CANVAS_PANEL_IDS) {
      if (prev?.[id] && !panels[id].open) {
        setClosingIds(ids => (ids.includes(id) ? ids : [...ids, id]))
      } else if (panels[id].open) {
        setClosingIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : ids))
      }
    }

    prevOpenRef.current = {
      botvault: panels.botvault.open,
      browser: panels.browser.open,
      chat: panels.chat.open
    }
  }, [panels])

  const onStowed = useCallback((id: CanvasPanelId) => {
    setClosingIds(ids => ids.filter(x => x !== id))
  }, [])

  const mountedIds = CANVAS_PANEL_IDS.filter(id => panels[id].open || closingIds.includes(id))

  // Auto slots are computed over every mounted panel (so a refolding panel
  // holds its slot until it's gone) and applied only where the user hasn't
  // placed the panel manually (rect === null). Cheap enough to run per render.
  const autoRects = autoArrangeRects(viewport, mountedIds)

  const rectFor = (id: CanvasPanelId): CanvasRect =>
    panels[id].rect ??
    autoRects[id] ?? {
      x: Math.round(viewport.w * 0.3),
      y: Math.round(viewport.h * 0.2),
      w: 480,
      h: 420
    }

  const topZ = Math.max(...CANVAS_PANEL_IDS.map(id => panels[id].z))

  // Open panels' on-screen rects, for the avatar's stay-clear logic.
  const openRects = CANVAS_PANEL_IDS.filter(id => panels[id].open).map(rectFor)

  const chatHostRef = useCallback((el: HTMLElement | null) => setCanvasChatHost(el), [])

  const content = (id: CanvasPanelId) => {
    switch (id) {
      case 'botvault':
        return (
          <BotVaultPane
            canvasLivePreview
            onActivateFile={path => insertVaultRef(path, false)}
            onActivateFolder={path => insertVaultRef(path, true)}
          />
        )

      case 'browser':
        return <BrowserPane />

      case 'chat':
        // ChatView (rendered by DesktopController) portals its DOM here — see
        // ./chat-host. Empty while a non-chat route is open.
        return <div className="flex h-full min-h-0 flex-col" ref={chatHostRef} />
    }
  }

  return (
    <div className="canvas-root" data-canvas-theme={theme.name} style={themeVars as CSSProperties}>
      <div className="canvas-drag-strip" />

      {mountedIds.map(id => (
        <CanvasPanel
          closeLabel={t.canvas.dismiss}
          focused={panels[id].open && panels[id].z === topZ}
          icon={PANEL_ICONS[id]}
          id={id}
          key={id}
          minHeight={PANEL_MIN[id].h}
          minWidth={PANEL_MIN[id].w}
          onStowed={onStowed}
          open={panels[id].open}
          rect={rectFor(id)}
          title={t.canvas.panels[id]}
          z={panels[id].z}
        >
          {content(id)}
        </CanvasPanel>
      ))}

      <AvatarOverlay
        avatar={avatar}
        panelRects={openRects}
        releaseLabel={t.canvas.avatarRelease}
        viewport={viewport}
      />

      <CanvasDock panels={panels} />
    </div>
  )
}
