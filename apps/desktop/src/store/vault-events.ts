/**
 * [Optimus Cockpit] BotVault live view — note-changed events + follow mode.
 *
 * Push, not poll, not watch. The vault lives on the NAS (mounted into CT115 /
 * CT117), so there is no local file to watch; the ONLY writer is Hermes, and
 * Hermes already announces every write to this window: `tool.complete` events
 * on the existing tui_gateway WebSocket carry the tool name + arguments. This
 * module derives a note-changed event from them — `{ path, timestamp, origin }`
 * — with zero backend changes and zero new connections.
 *
 * Origin semantics: everything derivable here is `'session'` by construction —
 * the /api/ws gateway is per-connection, so only sessions THIS window runs
 * stream tool events into the ladder. Background writers (cron, skills, the
 * CT115 voice service) never reach this channel; their coverage is a flagged
 * open item (see OPTIMUS.md), and the `origin` field is threaded through now
 * so a future background feed slots in without touching consumers: only
 * session-origin events may auto-summon, background events would live-update
 * an open note at most.
 *
 * Two streams, per the spec's timing rule:
 *   $vaultNoteActivity — fires on the FIRST event (leading edge), drives the
 *     follow-mode auto-open so the panel appears immediately.
 *   $vaultNoteRefresh  — per-path trailing debounce (400ms), drives the
 *     open-note re-fetch so incremental writes coalesce.
 *
 * Degradation is structural: no events → nothing here runs → the pane behaves
 * exactly as before this feature existed.
 */

import { atom } from 'nanostores'

import { BOTVAULT_PATH } from '@/app/botvault/use-vault-tree'
import { $canvasMode, summonPanel } from '@/app/canvas/store'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { Codecs, persistentAtom } from '@/lib/persisted'
import { $revealInTreeRequest, PREVIEW_PANE_ID, setBotVaultPaneOpen } from '@/store/layout'
import { setPaneOpen } from '@/store/panes'
import { $filePreviewTarget, setCurrentSessionPreviewTarget } from '@/store/preview'
import { toolMayMutateFiles } from '@/store/workspace-events'
import { $workspaceMode } from '@/store/workspace-mode'

const REFRESH_DEBOUNCE_MS = 400

export type VaultNoteOrigin = 'background' | 'session'

export interface VaultNoteEvent {
  origin: VaultNoteOrigin
  path: string
  /** Monotonic per emission so equal paths still register as new events. */
  tick: number
  timestamp: number
}

export const $vaultNoteActivity = atom<VaultNoteEvent | null>(null)
export const $vaultNoteRefresh = atom<VaultNoteEvent | null>(null)

/** Follow mode: session-origin writes to non-open notes summon the vault
 *  surface and open the note. Visible toggle on the pane header; default ON. */
export const $vaultFollowMode = persistentAtom('optimus.vault.followMode', true, Codecs.bool)

export function setVaultFollowMode(on: boolean): void {
  $vaultFollowMode.set(on)
}

export function toggleVaultFollowMode(): void {
  $vaultFollowMode.set(!$vaultFollowMode.get())
}

// ─── Path derivation from tool payloads ──────────────────────────────────────

// Argument keys file-writing tools plausibly carry their target under. Order
// matters only for determinism; the first vault-rooted hit wins.
const PATH_ARG_KEYS = [
  'path',
  'file_path',
  'filePath',
  'target_file',
  'targetFile',
  'file',
  'filename',
  'note_path',
  'notePath',
  'dest',
  'destination',
  'output_path',
  'outputPath'
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown

      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function vaultPathIn(args: Record<string, unknown> | null): string | null {
  if (!args) {
    return null
  }

  for (const key of PATH_ARG_KEYS) {
    const value = args[key]

    if (typeof value !== 'string') {
      continue
    }

    const path = value.trim().replace(/\/+$/, '')

    if (path === BOTVAULT_PATH || path.startsWith(`${BOTVAULT_PATH}/`)) {
      return path
    }
  }

  return null
}

/**
 * The vault path a finished tool wrote to, or null. Gated on the same
 * "may mutate files" heuristic the workspace tick uses, so read-only tools
 * (read_file has a `path` arg too) never register as writes.
 */
export function vaultPathFromToolPayload(payload: {
  args?: unknown
  arguments?: unknown
  inline_diff?: unknown
  input?: unknown
  name?: unknown
  tool?: unknown
}): string | null {
  if (!toolMayMutateFiles(payload)) {
    return null
  }

  const input = asRecord(payload.input)

  const candidates = [
    asRecord(payload.args),
    asRecord(payload.arguments),
    input,
    asRecord(input?.args),
    asRecord(input?.arguments),
    asRecord(input?.parameters)
  ]

  for (const args of candidates) {
    const path = vaultPathIn(args)

    if (path) {
      return path
    }
  }

  return null
}

// ─── Emission: leading activity + per-path trailing refresh ─────────────────

let nextTick = 0
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function notifyVaultNoteChanged(path: string, origin: VaultNoteOrigin): void {
  const event: VaultNoteEvent = { origin, path, tick: ++nextTick, timestamp: Date.now() }

  // Leading edge — follow mode reacts to the FIRST write immediately.
  $vaultNoteActivity.set(event)

  // Trailing per-path debounce — consumers re-fetch once per burst.
  const pending = refreshTimers.get(path)

  if (pending) {
    clearTimeout(pending)
  }

  refreshTimers.set(
    path,
    setTimeout(() => {
      refreshTimers.delete(path)
      $vaultNoteRefresh.set({ ...event, tick: ++nextTick, timestamp: Date.now() })
    }, REFRESH_DEBOUNCE_MS)
  )
}

// ─── Follow mode: auto-summon + open ─────────────────────────────────────────

// Re-entrancy guard: a burst of leading-edge events for the same note must not
// stack duplicate preview opens while the first normalize round-trip is inflight.
const autoOpenInflight = new Set<string>()

async function autoOpenNote(path: string): Promise<void> {
  if (autoOpenInflight.has(path)) {
    return
  }

  autoOpenInflight.add(path)

  try {
    // Summon the vault surface for the current layout mode. Stock mode has no
    // vault surface at all — nothing to summon (the open-note live refresh
    // still applies wherever a preview happens to be open).
    if ($canvasMode.get()) {
      summonPanel('botvault')
    } else if ($workspaceMode.get()) {
      setBotVaultPaneOpen(true)
      setPaneOpen(PREVIEW_PANE_ID, true)
    } else {
      return
    }

    // Reveal in the vault tree. The request self-consumes on the next mounted
    // tree (nanostores replays current value to new subscribers), so this works
    // whether the pane was already open or is mounting right now.
    $revealInTreeRequest.set(path)

    // Open the note in the preview surface, same path a manual tree click takes.
    const target = await normalizeOrLocalPreviewTarget(path, BOTVAULT_PATH)

    if (target) {
      setCurrentSessionPreviewTarget(target, 'file-browser', path)
    }
  } finally {
    autoOpenInflight.delete(path)
  }
}

$vaultNoteActivity.subscribe(event => {
  if (!event || event.origin !== 'session' || !$vaultFollowMode.get()) {
    return
  }

  // The open note is handled by the debounced live refresh; follow mode only
  // acts on writes to notes NOT currently open (including brand-new ones).
  if ($filePreviewTarget.get()?.path === event.path) {
    return
  }

  void autoOpenNote(event.path)
})
