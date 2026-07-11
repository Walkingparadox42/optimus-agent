/**
 * [Optimus Cockpit] Canvas theme registry — open-ended, keyed by profile.
 *
 * Adding a theme for a new (or existing) Hermes profile:
 *   1. Create `./<name>.ts` exporting a `CanvasTheme` token set.
 *   2. Register it in CANVAS_THEMES and map the profile in PROFILE_THEME_MAP.
 * No layout or panel code changes — the layer resolves through this module
 * only. Profiles without a designed theme (Scribe, Raven, Velvet today) fall
 * back to the default until they get their own token set.
 */

import { normalizeProfileKey } from '@/store/profile'

import { cybertronianTheme } from './cybertronian'
import type { CanvasTheme } from './types'

export { toCssVars } from './types'
export type { CanvasTheme } from './types'

const CANVAS_THEMES: Record<string, CanvasTheme> = {
  [cybertronianTheme.name]: cybertronianTheme
}

// Normalized profile key -> theme name. "default" is the primary profile,
// which is Optimus on this install.
const PROFILE_THEME_MAP: Record<string, string> = {
  default: cybertronianTheme.name,
  optimus: cybertronianTheme.name
}

const DEFAULT_CANVAS_THEME = cybertronianTheme.name

export function canvasThemeForProfile(profile: string | null | undefined): CanvasTheme {
  const key = normalizeProfileKey(profile).toLowerCase()
  const name = PROFILE_THEME_MAP[key] ?? DEFAULT_CANVAS_THEME

  return CANVAS_THEMES[name] ?? cybertronianTheme
}
