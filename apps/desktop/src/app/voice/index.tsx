import { useStore } from '@nanostores/react'
import { type FormEvent, useCallback, useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { voiceClient } from './client'
import {
  $voiceAnswer,
  $voiceConnection,
  $voiceError,
  $voiceServerUrl,
  $voiceToken,
  $voiceTranscript,
  $voiceTurnPhase
} from './store'

/**
 * [Optimus Cockpit] Voice controls — Phase 4 P1D-1 (push-to-talk).
 *
 * Lives inside the avatar pane (decision: Steve 2026-07-06 — the panel
 * meant to show live conversational state; $avatarListening already wires
 * there). Connects the renderer-owned voice client (ADR-0013) to the CT115
 * :9125 service. Server URL + token persist locally via the settings atoms
 * (pasted once, never committed); hold the button to talk, release to
 * commit, press while the assistant is audible to barge in.
 */

export function VoiceControls() {
  const { t } = useI18n()
  const v = t.voicePanel
  const connection = useStore($voiceConnection)
  const phase = useStore($voiceTurnPhase)
  const transcript = useStore($voiceTranscript)
  const answer = useStore($voiceAnswer)
  const error = useStore($voiceError)
  const serverUrl = useStore($voiceServerUrl)
  const token = useStore($voiceToken)

  const connect = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      void voiceClient.connect(serverUrl.trim(), token.trim())
    },
    [serverUrl, token]
  )

  // Pane unmount (workspace mode off / app teardown) → drop mic + socket.
  useEffect(() => () => voiceClient.disconnect(), [])

  const errorText =
    error === 'mic-denied' ? v.micDenied : error === 'connection-failed' ? v.connFailed : error

  const phaseLabel =
    phase === 'capturing'
      ? v.capturing
      : phase === 'thinking'
        ? v.thinking
        : phase === 'speaking'
          ? v.speaking
          : v.holdToTalk

  if (connection !== 'ready') {
    return (
      <form className="flex w-full max-w-64 flex-col items-center gap-2 px-4" onSubmit={connect}>
        {errorText && (
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-red)">{errorText}</p>
        )}
        <Input
          aria-label={v.serverUrlPlaceholder}
          autoComplete="off"
          onChange={event => $voiceServerUrl.set(event.target.value)}
          placeholder={v.serverUrlPlaceholder}
          value={serverUrl}
        />
        <Input
          aria-label={v.tokenPlaceholder}
          autoComplete="off"
          onChange={event => $voiceToken.set(event.target.value)}
          placeholder={v.tokenPlaceholder}
          type="password"
          value={token}
        />
        <Button disabled={!token.trim() || connection === 'connecting'} size="sm" type="submit" variant="secondary">
          {connection === 'connecting' ? v.connecting : v.connect}
        </Button>
      </form>
    )
  }

  return (
    <div className="flex w-full max-w-64 flex-col items-center gap-2 px-4">
      {errorText && (
        <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-red)">{errorText}</p>
      )}
      <Button
        aria-label={v.holdToTalk}
        className={cn('w-full select-none', phase === 'capturing' && 'ring-2 ring-(--ui-accent)')}
        onContextMenu={event => event.preventDefault()}
        onPointerCancel={() => voiceClient.pttUp()}
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          voiceClient.pttDown()
        }}
        onPointerUp={() => voiceClient.pttUp()}
        size="sm"
        variant="secondary"
      >
        {phaseLabel}
      </Button>
      {transcript && (
        <p className="max-h-16 w-full overflow-hidden text-center text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
          {transcript}
        </p>
      )}
      {answer && (
        <p className="max-h-24 w-full overflow-y-auto text-center text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          {answer}
        </p>
      )}
      <Button onClick={() => voiceClient.disconnect()} size="sm" variant="ghost">
        {v.disconnect}
      </Button>
    </div>
  )
}
