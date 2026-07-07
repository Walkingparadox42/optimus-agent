import { useStore } from '@nanostores/react'
import RFB from '@novnc/novnc'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $panesFlipped } from '@/store/layout'

import { RightSidebarSectionHeader } from '../right-sidebar'
import { SidebarPanelLabel } from '../shell/sidebar-label'

/**
 * [Optimus Cockpit] Browser viewport pane — Phase 6 step 1 (human plane ONLY).
 *
 * A noVNC client into the CT119 browser stack: pixels in, human mouse/keys
 * out, over RFB/websockify. The human input path deliberately bypasses the
 * agent entirely (ADR-0012) — nothing typed here ever becomes text in this
 * app or LLM context; it goes canvas → RFB → Xvfb → Firefox. The :9126 agent
 * verb API and Hermes tool wiring are LATER steps and intentionally absent.
 *
 * The framebuffer is fixed 1024x768 (CT119 sketch); noVNC's scaleViewport
 * scales it into the pane preserving aspect (letterboxing internally).
 * The VNC password is entered in-pane per session — kept in component state
 * only, never persisted, never in the repo (build-time auth requirement in
 * OPTIMUS.md Phase 6; secure storage is a later decision if needed).
 */

// CT119 "search-services" noVNC/websockify endpoint (see CLAUDE.md LAN map).
const VNC_WS_URL = 'ws://192.168.0.119:9127/websockify'

type ConnectionPhase = 'connected' | 'connecting' | 'idle'

export function BrowserPane() {
  const { t } = useI18n()
  const b = t.browserPane
  const panesFlipped = useStore($panesFlipped)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const rfbRef = useRef<RFB | null>(null)
  // True once 'securityfailure' fired for the in-flight attempt, so the
  // following 'disconnect' event reports a auth error instead of a generic one.
  const authFailedRef = useRef(false)

  const [phase, setPhase] = useState<ConnectionPhase>('idle')
  const [error, setError] = useState<null | string>(null)
  // Session-only; deliberately not persisted anywhere.
  const [password, setPassword] = useState('')

  const disconnect = useCallback(() => {
    rfbRef.current?.disconnect()
  }, [])

  const connect = useCallback(
    (event: FormEvent) => {
      event.preventDefault()

      const target = viewportRef.current

      if (!target || rfbRef.current) {
        return
      }

      setError(null)
      setPhase('connecting')
      authFailedRef.current = false

      const rfb = new RFB(target, VNC_WS_URL, { credentials: { password } })
      rfb.scaleViewport = true
      rfbRef.current = rfb

      rfb.addEventListener('connect', () => {
        setPhase('connected')
        rfb.focus()
      })

      rfb.addEventListener('securityfailure', () => {
        authFailedRef.current = true
      })

      rfb.addEventListener('disconnect', event => {
        const clean = Boolean((event as CustomEvent<{ clean?: boolean }>).detail?.clean)
        rfbRef.current = null
        setPhase('idle')

        if (authFailedRef.current) {
          setError(b.authFailed)
        } else if (!clean) {
          setError(b.lost)
        }
      })
    },
    [b.authFailed, b.lost, password]
  )

  // Unmount (workspace mode off / app teardown) → drop the socket.
  useEffect(() => () => rfbRef.current?.disconnect(), [])

  return (
    <aside
      aria-label={b.aria}
      className={cn(
        'relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--titlebar-height) text-(--ui-text-tertiary)',
        panesFlipped
          ? 'border-r shadow-[inset_-0.0625rem_0_0_color-mix(in_srgb,white_18%,transparent)]'
          : 'border-l shadow-[inset_0.0625rem_0_0_color-mix(in_srgb,white_18%,transparent)]'
      )}
    >
      <RightSidebarSectionHeader>
        <div className="flex min-w-0 flex-1">
          <SidebarPanelLabel>{b.title}</SidebarPanelLabel>
        </div>
        {phase === 'connected' && (
          <Button
            aria-label={b.disconnect}
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent! hover:text-sidebar-accent-foreground! focus-visible:ring-sidebar-ring"
            onClick={disconnect}
            size="icon-xs"
            title={b.disconnect}
            variant="ghost"
          >
            <Codicon name="debug-disconnect" size="0.8125rem" />
          </Button>
        )}
      </RightSidebarSectionHeader>

      <div className="relative min-h-0 flex-1">
        {/* noVNC target. Always mounted so the RFB constructor has a stable
            element; scaleViewport letterboxes the fixed 1024x768 framebuffer
            into whatever size the pane gives it. */}
        <div className={cn('absolute inset-0', phase !== 'connected' && 'invisible')} ref={viewportRef} />

        {phase === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader aria-label={b.connecting} />
          </div>
        )}

        {phase === 'idle' && (
          <form className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6" onSubmit={connect}>
            {error && (
              <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-red)">{error}</p>
            )}
            <Input
              aria-label={b.passwordPlaceholder}
              autoComplete="off"
              className="max-w-56"
              onChange={event => setPassword(event.target.value)}
              placeholder={b.passwordPlaceholder}
              type="password"
              value={password}
            />
            <Button disabled={!password} size="sm" type="submit" variant="secondary">
              {b.connect}
            </Button>
          </form>
        )}
      </div>
    </aside>
  )
}
