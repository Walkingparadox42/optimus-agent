/**
 * [Optimus Cockpit] Canvas mode root — flag gate + lazy mount.
 *
 * Rendered as a SIBLING of DesktopController (see app/index.tsx), never inside
 * it, so the stock tree is byte-for-byte unchanged while the flag is off. The
 * layer bundle only loads once canvas mode actually turns on.
 *
 * Secondary windows (pop-out composer, subagent watch) are compact scratch
 * surfaces — canvas mode is a primary-window concept and never mounts there.
 */

import { useStore } from '@nanostores/react'
import { lazy, Suspense } from 'react'

import { isSecondaryWindow } from '@/store/windows'

import { $canvasMode } from './store'

const CanvasLayer = lazy(async () => ({ default: (await import('./layer')).CanvasLayer }))

export function CanvasRoot() {
  const canvasMode = useStore($canvasMode)

  if (!canvasMode || isSecondaryWindow()) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <CanvasLayer />
    </Suspense>
  )
}
