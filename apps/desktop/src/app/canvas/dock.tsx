/**
 * [Optimus Cockpit] Canvas dock — the summon surface.
 *
 * A slim machined strip at the bottom center: one toggle per panel (lit tick
 * = open), reset-to-auto-arrange, and the exit back to the classic layout.
 * Dismissed panels come back from here (or the command palette).
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import {
  $activeGatewayProfile,
  $profileOrder,
  $profiles,
  normalizeProfileKey,
  refreshProfiles,
  selectProfile,
  sortByProfileOrder
} from '@/store/profile'

import { CANVAS_PANEL_IDS, type CanvasPanelId, type CanvasPanelsState, resetCanvasLayout, setCanvasMode, toggleCanvasPanel } from './store'

const PANEL_ICONS: Record<CanvasPanelId, string> = {
  botvault: 'database',
  browser: 'globe',
  chat: 'comment-discussion'
}

export function CanvasProfileSwitcher() {
  const { t } = useI18n()
  const profiles = useStore($profiles)
  const profileOrder = useStore($profileOrder)
  const activeKey = normalizeProfileKey(useStore($activeGatewayProfile))

  useEffect(() => {
    // The normal profile rail is hidden behind the canvas, so it may not have
    // refreshed the catalog. Keep this best-effort: a transient gateway error
    // must not make the rest of the canvas dock unusable.
    void refreshProfiles().catch(() => undefined)
  }, [])

  const orderedProfiles = useMemo(() => {
    const defaults = profiles.filter(profile => profile.is_default)

    const named = sortByProfileOrder(
      profiles.filter(profile => !profile.is_default),
      profileOrder
    )

    return [...defaults, ...named]
  }, [profileOrder, profiles])

  const activeProfile = orderedProfiles.find(profile => normalizeProfileKey(profile.name) === activeKey)
  const value = activeProfile?.name ?? ''
  const title = t.profiles.switchToProfile(activeProfile?.name ?? activeKey)

  return (
    <Select onValueChange={name => name && selectProfile(name)} value={value}>
      <SelectTrigger
        aria-label={t.profiles.title}
        className="canvas-profile-select"
        disabled={orderedProfiles.length === 0}
        size="xs"
        title={title}
      >
        <Codicon name="account" size="0.875rem" />
        <SelectValue placeholder={t.profiles.title} />
      </SelectTrigger>
      <SelectContent collisionPadding={8} side="top">
        {orderedProfiles.map(profile => (
          <SelectItem key={profile.name} value={profile.name}>
            {profile.name}
            {profile.is_default ? ` (${t.profiles.defaultBadge})` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CanvasDock({ panels }: { panels: CanvasPanelsState }) {
  const { t } = useI18n()
  const c = t.canvas

  return (
    <nav aria-label={c.dockAria} className="canvas-dock">
      <CanvasProfileSwitcher />

      <span aria-hidden className="canvas-dock-divider" />

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
