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
 * verb API lives on CT119 and is called by Hermes directly, not through this
 * pane.
 *
 * The framebuffer is fixed 1024x768 (CT119 sketch); noVNC's scaleViewport
 * scales it into the pane preserving aspect (letterboxing internally).
 * The VNC password is remembered in this renderer's local storage after a
 * successful connection so workspace toggles/app restarts auto-login without
 * committing the secret to source control.
 */

// CT119 "search-services" noVNC/websockify endpoint (see CLAUDE.md LAN map).
const VNC_WS_URL = 'ws://192.168.0.119:9127/websockify'
const VNC_PASSWORD_STORAGE_KEY = 'optimus.browser.vncPassword'

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
  const autoConnectAttemptedRef = useRef(false)

  const [phase, setPhase] = useState<ConnectionPhase>('idle')
  const [error, setError] = useState<null | string>(null)
  const [password, setPassword] = useState(() => localStorage.getItem(VNC_PASSWORD_STORAGE_KEY) ?? '')

  const disconnect = useCallback(() => {
    rfbRef.current?.disconnect()
  }, [])

  const connectWithPassword = useCallback(
    (nextPassword: string) => {
      const target = viewportRef.current

      if (!target || !nextPassword || rfbRef.current) {
        return
      }

      setError(null)
      setPhase('connecting')
      authFailedRef.current = false

      const rfb = new RFB(target, VNC_WS_URL, { credentials: { password: nextPassword } })
      rfb.scaleViewport = true
      rfbRef.current = rfb

      rfb.addEventListener('connect', () => {
        localStorage.setItem(VNC_PASSWORD_STORAGE_KEY, nextPassword)
        setPhase('connected')
        rfb.focus()
      })

      rfb.addEventListener('securityfailure', () => {
        authFailedRef.current = true
      })

      rfb.addEventListener('disconnect', event => {
        // A torn-down instance (teardown nulls the ref synchronously, or a
        // newer RFB has replaced it) must not touch live state — otherwise a
        // stale disconnect clobbers the connection that superseded it.
        if (rfbRef.current !== rfb) {
          return
        }

        const clean = Boolean((event as CustomEvent<{ clean?: boolean }>).detail?.clean)
        rfbRef.current = null
        setPhase('idle')

        if (authFailedRef.current) {
          // Server rejected the stored password: forget it and fall back to
          // the manual prompt (no silent retry loop).
          localStorage.removeItem(VNC_PASSWORD_STORAGE_KEY)
          setPassword('')
          setError(b.authFailed)
        } else if (!clean) {
          setError(b.lost)
        }
      })
    },
    [b.authFailed, b.lost]
  )

  const connect = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      connectWithPassword(password)
    },
    [connectWithPassword, password]
  )

  useEffect(() => {
    if (autoConnectAttemptedRef.current || !password || localStorage.getItem(VNC_PASSWORD_STORAGE_KEY) !== password) {
      return
    }

    autoConnectAttemptedRef.current = true
    connectWithPassword(password)
  }, [connectWithPassword, password])

  // Unmount (pane dismissed / app teardown) → drop the socket. The ref is
  // nulled SYNCHRONOUSLY (the RFB 'disconnect' event is async) and the
  // attempted flag reset, so a remount — including StrictMode's dev
  // mount→cleanup→mount cycle, which used to kill the auto-connect and land
  // on the password form every open — starts clean and auto-connects again.
  useEffect(
    () => () => {
      const rfb = rfbRef.current
      rfbRef.current = null
      autoConnectAttemptedRef.current = false
      rfb?.disconnect()
    },
    []
  )

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
