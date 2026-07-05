import { useStore } from '@nanostores/react'

import { TreeSkeleton } from '@/components/chat/skeletons'
import { ErrorBoundary } from '@/components/error-boundary'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useDelayedTrue } from '@/hooks/use-delayed-true'
import { useI18n } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { $panesFlipped } from '@/store/layout'
import { notifyError } from '@/store/notifications'
import { setCurrentSessionPreviewTarget } from '@/store/preview'

import { EmptyState, RightSidebarSectionHeader } from '../right-sidebar'
import { ProjectTree } from '../right-sidebar/files/tree'
import { SidebarPanelLabel } from '../shell/sidebar-label'

import { BOTVAULT_PATH, useVaultTree } from './use-vault-tree'

/**
 * [Optimus Cockpit] BotVault pane — Phase 1 increment 3.
 *
 * The vault-scoped file tree: the CT115 bind mount of the BotVault Obsidian
 * vault, pinned to `BOTVAULT_PATH` instead of following the session cwd.
 * Deliberately mirrors the file browser's chrome (same header, same tree
 * renderer, same activate/preview affordances) so the two panes read as one
 * system; only the state hook differs (see use-vault-tree). Workspace-mode
 * only — the Pane wrapper in desktop-controller is disabled outside it.
 */

interface BotVaultPaneProps {
  onActivateFile: (path: string) => void
  onActivateFolder: (path: string) => void
}

// Same hover-reveal header-action treatment as the file browser's header.
const HEADER_ACTION_CLASS =
  'text-sidebar-foreground/70 hover:bg-sidebar-accent! hover:text-sidebar-accent-foreground! focus-visible:ring-sidebar-ring'

const HEADER_ACTION_LABEL_REVEAL = `${HEADER_ACTION_CLASS} pointer-events-none opacity-0 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100`

export function BotVaultPane({ onActivateFile, onActivateFolder }: BotVaultPaneProps) {
  const { t } = useI18n()
  const r = t.rightSidebar
  const v = t.botvault
  const panesFlipped = useStore($panesFlipped)

  const {
    collapseAll,
    collapseNonce,
    data,
    loadChildren,
    openState,
    refreshRoot,
    rootError,
    rootLoading,
    setNodeOpen
  } = useVaultTree()

  const canCollapse = Object.values(openState).some(Boolean)
  const showSkeleton = useDelayedTrue(rootLoading && data.length === 0)

  const previewFile = async (path: string) => {
    try {
      const preview = await normalizeOrLocalPreviewTarget(path, BOTVAULT_PATH)

      if (!preview) {
        throw new Error(r.couldNotPreview(path))
      }

      setCurrentSessionPreviewTarget(preview, 'file-browser', path)
    } catch (error) {
      notifyError(error, r.previewUnavailable)
    }
  }

  return (
    <aside
      aria-label={v.aria}
      className={cn(
        'before:pointer-events-none relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--titlebar-height) text-(--ui-text-tertiary)',
        panesFlipped
          ? 'border-r shadow-[inset_-0.0625rem_0_0_color-mix(in_srgb,white_18%,transparent)]'
          : 'border-l shadow-[inset_0.0625rem_0_0_color-mix(in_srgb,white_18%,transparent)]'
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <RightSidebarSectionHeader>
          <div className="flex min-w-0 flex-1">
            <SidebarPanelLabel>{v.title}</SidebarPanelLabel>
          </div>
          <Button
            aria-label={r.refreshTree}
            className={HEADER_ACTION_LABEL_REVEAL}
            disabled={rootLoading}
            onClick={() => void refreshRoot()}
            size="icon-xs"
            title={r.refreshTree}
            variant="ghost"
          >
            <Codicon name="refresh" size="0.8125rem" spinning={rootLoading} />
          </Button>
          <Button
            aria-label={r.collapseAll}
            className={cn(HEADER_ACTION_CLASS, !canCollapse && 'pointer-events-none opacity-0')}
            disabled={!canCollapse}
            onClick={collapseAll}
            size="icon-xs"
            title={r.collapseAll}
            variant="ghost"
          >
            <Codicon name="collapse-all" size="0.8125rem" />
          </Button>
        </RightSidebarSectionHeader>

        {rootError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <EmptyState body={r.unreadableBody(rootError)} title={r.unreadableTitle} />
            <button
              className="text-[0.68rem] font-medium text-muted-foreground transition hover:text-foreground"
              onClick={() => void refreshRoot()}
              type="button"
            >
              {r.tryAgain}
            </button>
          </div>
        ) : rootLoading && data.length === 0 ? (
          showSkeleton ? (
            <div aria-label={r.loadingTree} className="min-h-0 flex-1" role="status">
              <TreeSkeleton />
            </div>
          ) : (
            <div className="min-h-0 flex-1" />
          )
        ) : data.length === 0 ? (
          <EmptyState body={v.emptyBody} title={v.emptyTitle} />
        ) : (
          <ErrorBoundary
            fallback={({ reset }) => (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                <EmptyState body={r.treeErrorBody} title={r.treeErrorTitle} />
                <button
                  className="text-[0.68rem] font-medium text-muted-foreground transition hover:text-foreground"
                  onClick={reset}
                  type="button"
                >
                  {r.tryAgain}
                </button>
              </div>
            )}
            label="botvault-tree"
          >
            <ProjectTree
              collapseNonce={collapseNonce}
              cwd={BOTVAULT_PATH}
              data={data}
              onActivateFile={onActivateFile}
              onActivateFolder={onActivateFolder}
              onLoadChildren={loadChildren}
              onNodeOpenChange={setNodeOpen}
              onPreviewFile={previewFile}
              openState={openState}
            />
          </ErrorBoundary>
        )}
      </div>
    </aside>
  )
}
