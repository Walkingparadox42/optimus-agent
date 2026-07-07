import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $avatarState, type AvatarState } from '@/store/avatar'

import { VoiceControls } from '../voice'

/**
 * [Optimus Cockpit] Avatar/presence pane — Phase 1 increments 2 + 4.
 *
 * A headshot with a state-tinted ring and a label, reacting live to
 * `$avatarState` (idle / listening / thinking / speaking / tool-use / waiting
 * / error). No 3D, no rigging (CLAUDE.md).
 *
 * Visuals are a pure file drop (increment 4): each state looks for its asset
 * at `public/avatar/<state>.webp` (see the README there for the contract);
 * any state whose file is missing falls back to the BrandMark placeholder, so
 * the pane works with zero, some, or all assets present. Renders only in
 * workspace mode — the Pane wrapper in desktop-controller is disabled outside
 * it.
 */

// Same BASE_URL-relative resolution as BrandMark's assetPath (local there).
const stateAsset = (state: AvatarState) => `${import.meta.env.BASE_URL}avatar/${state}.svg`

// One file per literal state name. Currently the Optimus Prime series —
// animated SVGs (SMIL), which play natively in the <img>; swapping a state to
// another <img>-supported format (animated WebP/GIF/APNG) is a one-line
// extension change here.
const ASSET_BY_STATE: Record<AvatarState, string> = {
  error: stateAsset('error'),
  idle: stateAsset('idle'),
  listening: stateAsset('listening'),
  speaking: stateAsset('speaking'),
  thinking: stateAsset('thinking'),
  toolUse: stateAsset('toolUse'),
  waiting: stateAsset('waiting')
}

// Ring tint per state. Idle stays on the quiet hairline token; activity moves
// to accent/brand; error uses the shared red.
const RING_TOKEN: Record<AvatarState, string> = {
  error: 'var(--ui-red)',
  idle: 'var(--ui-stroke-tertiary)',
  listening: 'var(--ui-accent)',
  speaking: 'var(--ui-accent)',
  thinking: 'var(--theme-primary)',
  toolUse: 'var(--theme-primary)',
  waiting: 'var(--ui-accent)'
}

// States that breathe. waiting/error hold a steady tint instead — a paused or
// failed turn shouldn't read as ongoing activity.
const ANIMATED_STATES: ReadonlySet<AvatarState> = new Set(['listening', 'speaking', 'thinking', 'toolUse'])

export function AvatarPane() {
  const { t } = useI18n()
  const state = useStore($avatarState)

  // States whose asset file failed to load (typically: not shipped yet).
  // Component state, not module state, so reopening the pane re-probes —
  // dropping a new asset in shows up on the next pane toggle without a
  // relaunch. onError fires near-instantly for missing local files.
  const [failedAssets, setFailedAssets] = useState<ReadonlySet<AvatarState>>(new Set())
  const hasAsset = !failedAssets.has(state)

  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center gap-3 pt-(--titlebar-height)"
      data-avatar-state={state}
    >
      <span
        className={cn(
          'rounded-full border-2 p-1 transition-colors duration-300',
          ANIMATED_STATES.has(state) && 'motion-safe:animate-pulse'
        )}
        style={{ borderColor: RING_TOKEN[state] }}
      >
        {hasAsset ? (
          // Decorative: the state is announced by the text label below.
          <img
            alt=""
            className="size-24 rounded-full object-cover"
            onError={() => setFailedAssets(prev => new Set(prev).add(state))}
            src={ASSET_BY_STATE[state]}
          />
        ) : (
          <BrandMark className="size-24 rounded-full" />
        )}
      </span>
      <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
        {t.avatarPane.states[state]}
      </span>
      {/* Phase 4 P1D-1: the voice client lives in this pane (Steve
          2026-07-06) — it is the surface for live conversational state. */}
      <VoiceControls />
    </div>
  )
}
