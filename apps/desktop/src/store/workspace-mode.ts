/**
 * [Optimus Cockpit] Workspace mode — Phase 1 cockpit shell seam.
 *
 * A single persisted flag that re-composes the EXISTING PaneShell into a
 * Joshu-like docked workspace (chat centre, file browser + preview docked open)
 * without touching the stock layout: when off, everything is byte-for-byte the
 * default app. Pane open/width state is persisted per scope (see
 * `setPaneScope` in ./panes), so the workspace remembers its own arrangement
 * independently of stock mode and each pane can be toggled within it.
 *
 * This flag is the seam every later cockpit pane (avatar, browser, BotVault)
 * will hang off. Toggle it from the command palette or Settings > Appearance.
 */

import { Codecs, persistentAtom } from '@/lib/persisted'
import {
  AVATAR_PANE_ID,
  BOTVAULT_PANE_ID,
  BROWSER_PANE_ID,
  CHAT_SIDEBAR_PANE_ID,
  FILE_BROWSER_PANE_ID,
  PREVIEW_PANE_ID
} from '@/store/layout'

import { type PaneStateSnapshot, setPaneScope } from './panes'

const WORKSPACE_MODE_STORAGE_KEY = 'hermes.desktop.workspaceMode'

// Default arrangement seeded the FIRST time workspace mode is entered (before
// the user has arranged it themselves). Docks the sessions sidebar, the file
// browser, the preview rail, and the avatar/presence pane open around the
// centre chat. Panes not listed fall back to their own `defaultOpen`. Preview
// only paints when it has content, so seeding it open is harmless until there's
// something to show.
const WORKSPACE_PANE_SEED: Record<string, PaneStateSnapshot> = {
  [AVATAR_PANE_ID]: { open: true },
  [BOTVAULT_PANE_ID]: { open: true },
  [BROWSER_PANE_ID]: { open: true },
  [CHAT_SIDEBAR_PANE_ID]: { open: true },
  // The root (full-filesystem) file browser does NOT exist in workspace mode
  // (Steve, 2026-07-07): its Pane is disabled there and every file-surface
  // affordance (titlebar edge button, view.showFiles / view.toggleRightSidebar
  // keybinds) drives BotVault instead. Seeded closed for hygiene — the entry
  // is inert while the pane is disabled.
  [FILE_BROWSER_PANE_ID]: { open: false },
  [PREVIEW_PANE_ID]: { open: true }
}

export const $workspaceMode = persistentAtom(WORKSPACE_MODE_STORAGE_KEY, false, Codecs.bool)

// Keep the pane-state bucket in sync with the flag. nanostores fires this
// immediately with the current value, so a session that was last in workspace
// mode restores its workspace pane arrangement on boot.
$workspaceMode.subscribe(on => {
  setPaneScope(on ? 'workspace' : 'stock', on ? WORKSPACE_PANE_SEED : undefined)
})

export function setWorkspaceMode(on: boolean): void {
  $workspaceMode.set(on)
}

export function toggleWorkspaceMode(): void {
  $workspaceMode.set(!$workspaceMode.get())
}
