/**
 * [Optimus Cockpit] Canvas chat host — the re-parenting bridge.
 *
 * The chat spine's entire wiring (gateway, composer actions, message stream,
 * session cache) lives in DesktopController, which renders <ChatView> inside
 * the stock PaneMain. Canvas mode must not rebuild that wiring, and the
 * protected files must not change — so instead of a second ChatView, the
 * canvas chat panel registers a HOST ELEMENT here and ChatView portals its
 * existing, fully-wired DOM into it (see the flagged extension at the bottom
 * of app/chat/index.tsx). React context, handlers, and state all keep flowing
 * through the original tree; only the DOM re-parents.
 *
 * null host (canvas off, or chat panel dismissed) = ChatView renders in place,
 * exactly as stock.
 */

import { atom } from 'nanostores'

export const $canvasChatHost = atom<HTMLElement | null>(null)

export function setCanvasChatHost(el: HTMLElement | null): void {
  $canvasChatHost.set(el)
}
