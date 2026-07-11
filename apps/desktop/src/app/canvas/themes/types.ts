/**
 * [Optimus Cockpit] Canvas theme tokens.
 *
 * One token set per Hermes avatar profile, applied as `--canvas-*` custom
 * properties on the canvas layer root (see toCssVars). All canvas chrome —
 * background, plates, dock, avatar shell, motion — styles exclusively off
 * these variables (canvas.css), so a new profile theme is a new token file +
 * one registry entry, never a layout or panel-code change.
 *
 * Panel CONTENTS (chat thread, vault tree, browser viewport) keep the app
 * theme's own tokens — the canvas themes only own the shell around them.
 */

export interface CanvasTheme {
  /** Registry key, kebab-case. */
  name: string
  label: string

  /** Full-viewport background (layered CSS background value). */
  canvasBackground: string
  /** Faint structural etching over the background (grid/panel lines). */
  canvasEtch: string
  /** Ambient glow accents layered above the etch (radial gradients). */
  canvasGlow: string

  /** Plate (floating panel) chrome. */
  plateSurface: string
  plateBorder: string
  /** Beveled top-edge highlight. */
  plateEdge: string
  /** Etched detail lines inside the plate chrome. */
  plateEtch: string
  plateShadow: string
  /** Border + glow treatment for the focused (topmost) plate. */
  plateFocusBorder: string
  plateFocusGlow: string
  /** Corner chamfer size (CSS length) — plates are machined, not rounded. */
  chamfer: string

  /** Plate title bar. */
  titleSurface: string
  titleText: string

  text: string
  textDim: string

  /** Sparse accents — primary (blue family) and alert (red family). */
  accent: string
  accentAlt: string

  /** Dock + avatar shell surfaces. */
  dockSurface: string
  dockBorder: string

  /** Motion language. */
  summonMs: number
  dismissMs: number
  ease: string
}

/** Flatten a token set into the `--canvas-*` custom properties canvas.css consumes. */
export function toCssVars(theme: CanvasTheme): Record<string, string> {
  return {
    '--canvas-background': theme.canvasBackground,
    '--canvas-etch': theme.canvasEtch,
    '--canvas-glow': theme.canvasGlow,
    '--canvas-plate-surface': theme.plateSurface,
    '--canvas-plate-border': theme.plateBorder,
    '--canvas-plate-edge': theme.plateEdge,
    '--canvas-plate-etch': theme.plateEtch,
    '--canvas-plate-shadow': theme.plateShadow,
    '--canvas-plate-focus-border': theme.plateFocusBorder,
    '--canvas-plate-focus-glow': theme.plateFocusGlow,
    '--canvas-chamfer': theme.chamfer,
    '--canvas-title-surface': theme.titleSurface,
    '--canvas-title-text': theme.titleText,
    '--canvas-text': theme.text,
    '--canvas-text-dim': theme.textDim,
    '--canvas-accent': theme.accent,
    '--canvas-accent-alt': theme.accentAlt,
    '--canvas-dock-surface': theme.dockSurface,
    '--canvas-dock-border': theme.dockBorder,
    '--canvas-summon-ms': `${theme.summonMs}ms`,
    '--canvas-dismiss-ms': `${theme.dismissMs}ms`,
    '--canvas-ease': theme.ease
  }
}
