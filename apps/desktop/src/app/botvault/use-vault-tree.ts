/**
 * [Optimus Cockpit] BotVault tree state — Phase 1 increment 3.
 *
 * A lean, self-contained sibling of `../right-sidebar/files/use-project-tree`:
 * that hook's state is a module-level singleton owned by the file browser, so
 * a second simultaneous tree (this pane docks NEXT TO the file browser in
 * workspace mode) needs its own state container. Kept additive per CLAUDE.md
 * rule 7 — the shared hook is upstream-maintained and stays untouched; we
 * reuse its pure IPC layer (`readProjectDir`, path-keyed cache) and its
 * `TreeNode` shape so the shared `ProjectTree` renderer works unchanged.
 *
 * The root is FIXED at the vault path (no cwd-following, no local fallback —
 * the vault only exists on CT115, so a read failure surfaces as an error state
 * that self-heals by retrying, e.g. across a gateway reconnect).
 */

import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useCallback, useEffect, useMemo } from 'react'

import { $connection } from '@/store/session'
import { $workspaceChangeTick } from '@/store/workspace-events'

import { readProjectDir } from '../right-sidebar/files/ipc'
import type { TreeNode } from '../right-sidebar/files/use-project-tree'

/** CT115-side vault root: bind mount of MagicNAS /mnt/storage/obsidian/BotVault
 *  (confirmed by Steve 2026-07-05; see OPTIMUS.md increment 3). */
export const BOTVAULT_PATH = '/mnt/vaults/BotVault'

const ROOT_ERROR_RETRY_MS = 3_000
const PLACEHOLDER_ID = '__loading__'
const ERROR_PLACEHOLDER_ID = '__error__'

const makeNode = (path: string, name: string, isDirectory: boolean): TreeNode => ({ id: path, isDirectory, name })

const placeholderChild = (parentId: string): TreeNode => ({
  id: `${parentId}::${PLACEHOLDER_ID}`,
  isDirectory: false,
  name: 'Loading…',
  placeholder: 'loading'
})

const errorChild = (parentId: string, error: string | undefined): TreeNode => ({
  id: `${parentId}::${ERROR_PLACEHOLDER_ID}`,
  isDirectory: false,
  name: `Unable to read (${error || 'read-error'})`,
  placeholder: 'error'
})

/** Replace the node with `id` (searching loaded children) via `patch`. */
export function patchNode(nodes: TreeNode[], id: string, patch: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map(n => {
    if (n.id === id) {
      return patch(n)
    }

    if (n.children && n.children.length > 0) {
      return { ...n, children: patchNode(n.children, id, patch) }
    }

    return n
  })
}

/**
 * Merge freshly-read `entries` over `existing` children: keep loaded subtrees
 * and node identity (paths) so expansion survives, add new entries, drop
 * deleted ones. Pure — exported for tests.
 */
export function mergeEntries(
  existing: TreeNode[],
  entries: readonly { path: string; name: string; isDirectory: boolean }[]
): TreeNode[] {
  const byId = new Map(existing.filter(node => !node.placeholder).map(node => [node.id, node]))

  return entries.map(entry => byId.get(entry.path) ?? makeNode(entry.path, entry.name, entry.isDirectory))
}

interface VaultTreeState {
  collapseNonce: number
  data: TreeNode[]
  loaded: boolean
  openState: Record<string, boolean>
  requestId: number
  rootError: string | null
  rootLoading: boolean
}

const initialState: VaultTreeState = {
  collapseNonce: 0,
  data: [],
  loaded: false,
  openState: {},
  requestId: 0,
  rootError: null,
  rootLoading: false
}

// One vault pane per window, so (unlike the multi-project file browser) a
// single module atom is the honest shape. Survives pane close/reopen.
const $vaultTree = atom<VaultTreeState>(initialState)
const inflight = new Set<string>()
let nextRequestId = 0

const setVaultTree = (updater: (current: VaultTreeState) => VaultTreeState) => $vaultTree.set(updater($vaultTree.get()))

async function loadRoot({ force = false }: { force?: boolean } = {}) {
  const current = $vaultTree.get()

  if (!force && (current.loaded || current.rootLoading)) {
    return
  }

  const requestId = ++nextRequestId
  inflight.clear()

  setVaultTree(latest => ({
    ...latest,
    data: [],
    loaded: false,
    requestId,
    rootError: null,
    rootLoading: true
  }))

  const { entries, error } = await readProjectDir(BOTVAULT_PATH, BOTVAULT_PATH)

  setVaultTree(latest => {
    if (latest.requestId !== requestId) {
      return latest
    }

    return {
      ...latest,
      data: error ? [] : entries.map(e => makeNode(e.path, e.name, e.isDirectory)),
      loaded: true,
      rootError: error || null,
      rootLoading: false
    }
  })
}

// Non-destructive refresh (agent wrote to the vault): re-read the root and
// every loaded directory, merging so expansion and loaded subtrees survive.
async function revalidateVault(): Promise<void> {
  const state = $vaultTree.get()

  if (!state.loaded || state.rootError) {
    return
  }

  const reconcile = async (dirPath: string, existing: TreeNode[]): Promise<TreeNode[]> => {
    const { entries, error } = await readProjectDir(dirPath, BOTVAULT_PATH)

    if (error) {
      return existing // keep last-known children on a transient read error
    }

    const merged = mergeEntries(existing, entries)

    return Promise.all(
      merged.map(async node =>
        node.isDirectory && node.children ? { ...node, children: await reconcile(node.id, node.children) } : node
      )
    )
  }

  const nextData = await reconcile(BOTVAULT_PATH, state.data)

  setVaultTree(latest => (latest.loaded ? { ...latest, data: nextData } : latest))
}

export interface UseVaultTreeResult {
  collapseNonce: number
  data: TreeNode[]
  openState: Record<string, boolean>
  rootError: string | null
  rootLoading: boolean
  collapseAll: () => void
  loadChildren: (id: string) => Promise<void>
  refreshRoot: () => Promise<void>
  setNodeOpen: (id: string, open: boolean) => void
}

export function useVaultTree(): UseVaultTreeResult {
  const state = useStore($vaultTree)
  const connection = useStore($connection)
  const workspaceTick = useStore($workspaceChangeTick)
  const connectionKey = `${connection?.mode || 'local'}:${connection?.profile || ''}:${connection?.baseUrl || ''}`

  const refreshRoot = useCallback(() => loadRoot({ force: true }), [])

  const setNodeOpen = useCallback((id: string, open: boolean) => {
    setVaultTree(current =>
      current.openState[id] === open ? current : { ...current, openState: { ...current.openState, [id]: open } }
    )
  }, [])

  const collapseAll = useCallback(() => {
    setVaultTree(current => ({ ...current, collapseNonce: current.collapseNonce + 1, openState: {} }))
  }, [])

  const loadChildren = useCallback(async (id: string) => {
    if (inflight.has(id)) {
      return
    }

    inflight.add(id)

    setVaultTree(current => ({
      ...current,
      data: patchNode(current.data, id, n => ({ ...n, loading: true, children: [placeholderChild(n.id)] }))
    }))

    const { entries, error } = await readProjectDir(id, BOTVAULT_PATH)

    inflight.delete(id)

    setVaultTree(current => ({
      ...current,
      data: patchNode(current.data, id, n => ({
        ...n,
        loading: false,
        error: error || undefined,
        children: error ? [errorChild(n.id, error)] : entries.map(e => makeNode(e.path, e.name, e.isDirectory))
      }))
    }))
  }, [])

  // Initial load on first mount; a connection change (reconnect, profile swap)
  // forces a re-read so the pane recovers without a manual refresh.
  useEffect(() => {
    void loadRoot({ force: state.loaded || Boolean(state.rootError) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on connection change
  }, [connectionKey])

  // Live refresh when the agent touches files (tick 0 is the initial value).
  useEffect(() => {
    if (workspaceTick > 0) {
      void revalidateVault()
    }
  }, [workspaceTick])

  // Self-heal an errored root (vault unreachable mid-reconnect) on a slow
  // cadence while the pane is mounted.
  useEffect(() => {
    if (!state.rootError) {
      return
    }

    const timer = window.setTimeout(() => void loadRoot({ force: true }), ROOT_ERROR_RETRY_MS)

    return () => window.clearTimeout(timer)
  }, [state.requestId, state.rootError])

  return useMemo(
    () => ({
      collapseAll,
      collapseNonce: state.collapseNonce,
      data: state.data,
      loadChildren,
      openState: state.openState,
      refreshRoot,
      rootError: state.rootError,
      rootLoading: state.rootLoading,
      setNodeOpen
    }),
    [
      collapseAll,
      loadChildren,
      refreshRoot,
      setNodeOpen,
      state.collapseNonce,
      state.data,
      state.openState,
      state.rootError,
      state.rootLoading
    ]
  )
}
