/**
 * [Optimus Cockpit] Cybertronian — the Optimus profile's canvas theme.
 *
 * Direction (locked): dark metallic base with real depth, blue and red as
 * sparse accents only, plates that read as machined metal (chamfers, bevels,
 * etched seams), transformation-adjacent motion, and restraint — negative
 * space over HUD busyness.
 */

import type { CanvasTheme } from './types'

// Palette anchors. Steel neutrals carry the surface; the blue is Autobot-cool
// and reserved for focus/active signals, the red for alerts and single points
// of emphasis (close affordances, the dock's live indicator).
const STEEL_900 = '#0b0e13'
const STEEL_800 = '#10141b'
const STEEL_700 = '#161c26'
const STEEL_500 = '#2a3442'
const STEEL_LINE = '#3a4656'
const BLUE = '#4f8fd9'
const RED = '#c04545'

export const cybertronianTheme: CanvasTheme = {
  name: 'cybertronian',
  label: 'Cybertronian',

  // Brushed-dark field: a diagonal steel gradient with a deep vignette so the
  // canvas has depth instead of flat black.
  canvasBackground: [
    `radial-gradient(115% 90% at 50% -10%, ${STEEL_700} 0%, ${STEEL_800} 46%, ${STEEL_900} 100%)`,
    `linear-gradient(160deg, ${STEEL_800} 0%, ${STEEL_900} 70%)`
  ].join(', '),
  // Sparse machined seams: a coarse plate grid, barely above the surface.
  canvasEtch: [
    `repeating-linear-gradient(0deg, transparent 0px, transparent 159px, ${STEEL_500}26 159px, ${STEEL_500}26 160px)`,
    `repeating-linear-gradient(90deg, transparent 0px, transparent 159px, ${STEEL_500}26 159px, ${STEEL_500}26 160px)`
  ].join(', '),
  // One cool key light high-left, one faint red ember low-right. Both dim —
  // accents, not fills.
  canvasGlow: [
    `radial-gradient(46rem 30rem at 18% 4%, ${BLUE}14 0%, transparent 70%)`,
    `radial-gradient(38rem 26rem at 88% 102%, ${RED}0e 0%, transparent 72%)`
  ].join(', '),

  // Plates: vertical metal gradient, hairline steel border, a bright bevel on
  // the top edge and etched seam lines handled by canvas.css.
  plateSurface: `linear-gradient(180deg, ${STEEL_700}f5 0%, ${STEEL_800}fa 34%, ${STEEL_900}fc 100%)`,
  plateBorder: STEEL_LINE,
  plateEdge: '#6d7c90',
  plateEtch: `${STEEL_LINE}66`,
  plateShadow: '0 18px 48px -18px #000000d9, 0 4px 14px -6px #000000a6',
  plateFocusBorder: `${BLUE}b3`,
  plateFocusGlow: `0 0 0 1px ${BLUE}40, 0 0 22px -6px ${BLUE}59, 0 18px 48px -18px #000000d9`,
  chamfer: '14px',

  titleSurface: `linear-gradient(180deg, ${STEEL_500}59 0%, transparent 100%)`,
  titleText: '#c7d3e2',

  text: '#d4dce7',
  textDim: '#8494a8',

  accent: BLUE,
  accentAlt: RED,

  dockSurface: `linear-gradient(180deg, ${STEEL_700}f2 0%, ${STEEL_900}f7 100%)`,
  dockBorder: STEEL_LINE,

  // Mechanical, quick, decisive — plates deploy, they don't fade.
  summonMs: 340,
  dismissMs: 240,
  ease: 'cubic-bezier(0.22, 0.9, 0.28, 1)'
}
