import { atom, computed, type ReadableAtom } from 'nanostores'

export interface PaneStateSnapshot {
  open: boolean
  widthOverride?: number
  /** Vertical size override (px) for panes that resize on the Y axis (e.g. the bottom-row terminal). */
  heightOverride?: number
}

export interface PaneRegisterDefaults {
  open: boolean
  widthOverride?: number
}

// [Optimus Cockpit] Pane open/width state is persisted per SHELL SCOPE so the
// cockpit "workspace mode" remembers its own pane arrangement independently of
// the stock layout. The stock bucket key is unchanged, so stock-mode behavior
// (and its stored state) is byte-for-byte identical. Switching scope swaps which
// bucket backs $paneStates; every consumer keeps reading the same atom.
const STOCK_STORAGE_KEY = 'hermes.desktop.paneStates.v1'
const WORKSPACE_STORAGE_KEY = 'hermes.desktop.paneStates.workspace.v1'

export type PaneScope = 'stock' | 'workspace'

const scopeKey = (scope: PaneScope): string =>
  scope === 'workspace' ? WORKSPACE_STORAGE_KEY : STOCK_STORAGE_KEY

// The bucket currently backing $paneStates. Starts on stock so module init and
// the initial persist target match the pre-cockpit behavior exactly.
let currentScope: PaneScope = 'stock'

function isSnapshot(value: unknown): value is PaneStateSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }

  const r = value as Record<string, unknown>

  if (typeof r.open !== 'boolean') {
    return false
  }

  const widthOk =
    r.widthOverride === undefined || (typeof r.widthOverride === 'number' && Number.isFinite(r.widthOverride))

  const heightOk =
    r.heightOverride === undefined || (typeof r.heightOverride === 'number' && Number.isFinite(r.heightOverride))

  return widthOk && heightOk
}

function load(storageKey: string): Record<string, PaneStateSnapshot> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(storageKey)

    if (raw) {
      const parsed = JSON.parse(raw) as unknown

      if (parsed && typeof parsed === 'object') {
        const out: Record<string, PaneStateSnapshot> = {}

        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (isSnapshot(value)) {
            out[id] = { open: value.open, widthOverride: value.widthOverride, heightOverride: value.heightOverride }
          }
        }

        return out
      }
    }
  } catch {
    // Treat unparseable persisted state as missing.
  }

  return {}
}

// Persists both open state and resize width; load() validates each snapshot.
function persist(states: Record<string, PaneStateSnapshot>, storageKey: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(states))
  } catch {
    // Storage failures are nonfatal.
  }
}

export const $paneStates = atom<Record<string, PaneStateSnapshot>>(load(scopeKey(currentScope)))

// Always persist to whichever bucket is currently active.
$paneStates.subscribe(states => persist(states, scopeKey(currentScope)))

// Swap which persisted bucket backs $paneStates. Saves the current bucket, then
// loads the target one. Seed entries fill in only the pane ids the stored
// bucket doesn't know yet — so the first entry gets the full default
// arrangement, and a cockpit pane introduced by a later update appears with its
// seeded state in an existing workspace without clobbering the user's saved
// arrangement. A no-op when already on `scope`. Driven by the workspace-mode
// store; panes.ts stays free of any workspace/layout imports to avoid a cycle.
export function setPaneScope(scope: PaneScope, seed?: Record<string, PaneStateSnapshot>): void {
  if (scope === currentScope) {
    return
  }

  // Flush the outgoing bucket before switching so nothing is lost.
  persist($paneStates.get(), scopeKey(currentScope))
  currentScope = scope

  const loaded = load(scopeKey(scope))

  // The subscribe above writes the set value straight into the new bucket, so
  // seeded defaults persist as soon as they're applied.
  $paneStates.set(seed ? { ...seed, ...loaded } : loaded)
}

// Cached per-pane derived atoms keep useStore subscriptions referentially stable.
function memoized<T>(
  cache: Map<string, ReadableAtom<T>>,
  id: string,
  selector: (s: PaneStateSnapshot | undefined) => T
) {
  let cached = cache.get(id)

  if (!cached) {
    cached = computed($paneStates, states => selector(states[id]))
    cache.set(id, cached)
  }

  return cached
}

const openCache = new Map<string, ReadableAtom<boolean>>()
const stateCache = new Map<string, ReadableAtom<PaneStateSnapshot | undefined>>()
const widthCache = new Map<string, ReadableAtom<number | undefined>>()
const heightCache = new Map<string, ReadableAtom<number | undefined>>()

export const $paneOpen = (id: string) => memoized(openCache, id, s => s?.open ?? false)
export const $paneState = (id: string) => memoized(stateCache, id, s => s)
export const $paneWidthOverride = (id: string) => memoized(widthCache, id, s => s?.widthOverride)
export const $paneHeightOverride = (id: string) => memoized(heightCache, id, s => s?.heightOverride)

export function ensurePaneRegistered(id: string, defaults: PaneRegisterDefaults) {
  const current = $paneStates.get()

  if (current[id] !== undefined) {
    return
  }

  $paneStates.set({ ...current, [id]: { open: defaults.open, widthOverride: defaults.widthOverride } })
}

export function setPaneOpen(id: string, open: boolean) {
  const current = $paneStates.get()
  const existing = current[id]

  if (existing?.open === open) {
    return
  }

  $paneStates.set({ ...current, [id]: { ...existing, open } })
}

export function togglePane(id: string) {
  const current = $paneStates.get()
  const existing = current[id]
  $paneStates.set({ ...current, [id]: { ...existing, open: !(existing?.open ?? false) } })
}

export function setPaneWidthOverride(id: string, width: number | undefined) {
  const current = $paneStates.get()
  const existing = current[id] ?? { open: false }

  if (existing.widthOverride === width) {
    return
  }

  $paneStates.set({ ...current, [id]: { ...existing, widthOverride: width } })
}

export function setPaneHeightOverride(id: string, height: number | undefined) {
  const current = $paneStates.get()
  const existing = current[id] ?? { open: false }

  if (existing.heightOverride === height) {
    return
  }

  $paneStates.set({ ...current, [id]: { ...existing, heightOverride: height } })
}

export const clearPaneWidthOverride = (id: string) => setPaneWidthOverride(id, undefined)
export const clearPaneHeightOverride = (id: string) => setPaneHeightOverride(id, undefined)
export const getPaneStateSnapshot = (id: string) => $paneStates.get()[id]
