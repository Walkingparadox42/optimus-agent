/**
 * [Optimus Cockpit] Minimal typings for @novnc/novnc (ships none). Covers only
 * the surface the browser pane uses; events arrive as CustomEvents via the
 * EventTarget interface ('connect', 'disconnect' {clean}, 'securityfailure'
 * {status, reason}, 'credentialsrequired').
 */
declare module '@novnc/novnc' {
  export interface NoVncCredentials {
    username?: string
    password?: string
    target?: string
  }

  export interface NoVncOptions {
    credentials?: NoVncCredentials
    repeaterID?: string
    shared?: boolean
    wsProtocols?: string[]
  }

  export default class RFB extends EventTarget {
    constructor(target: Element, urlOrChannel: string | WebSocket, options?: NoVncOptions)
    disconnect(): void
    focus(options?: FocusOptions): void
    blur(): void
    background: string
    clipViewport: boolean
    resizeSession: boolean
    scaleViewport: boolean
    viewOnly: boolean
  }
}
