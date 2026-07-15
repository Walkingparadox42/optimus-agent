import { VaultLiveEventBridge } from './botvault/live-events'
import { CanvasRoot } from './canvas'
import { DesktopController } from './desktop-controller'

/**
 * [Optimus Cockpit] App root: the stock DesktopController plus the canvas-mode
 * layer as a SIBLING. CanvasRoot renders null unless the canvasMode flag is on
 * (and never in secondary windows), so the default tree is unchanged. This is
 * the only mount-point change canvas mode makes — DesktopController itself is
 * protected and untouched.
 */
export default function App() {
  return (
    <>
      <DesktopController />
      <CanvasRoot />
      <VaultLiveEventBridge />
    </>
  )
}
