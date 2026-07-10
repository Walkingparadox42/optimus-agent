import { useStore } from '@nanostores/react'
import { type FormEvent, useCallback, useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { alwaysOn } from './always-on'
import { voiceClient } from './client'
import {
  $voiceAlwaysOn,
  $voiceAnswer,
  $voiceConnection,
  $voiceEchoTest,
  $voiceError,
  $voiceServerUrl,
  $voiceToken,
  $voiceTranscript,
  $voiceTurnPhase,
  $voiceWakeState
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
  const echoTest = useStore($voiceEchoTest)
  const alwaysOnPref = useStore($voiceAlwaysOn)
  const wakeState = useStore($voiceWakeState)

  const connect = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      void voiceClient.connect(serverUrl.trim(), token.trim())
    },
    [serverUrl, token]
  )

  // Pane unmount (workspace mode off / app teardown) → drop mic + socket.
  useEffect(() => () => {
    alwaysOn.disable()
    voiceClient.disconnect()
  }, [])

  // Always-on follows the persisted preference while a session is live.
  useEffect(() => {
    if (connection === 'ready' && alwaysOnPref) {
      void alwaysOn.enable()
    } else {
      alwaysOn.disable()
    }
  }, [alwaysOnPref, connection])

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

  const showStop = phase !== 'idle' || wakeState === 'window'

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
        disabled={phase === 'capturing'}
        onClick={() => voiceClient.clickToTalk()}
        size="sm"
        variant="secondary"
      >
        {phaseLabel}
      </Button>
      {showStop && (
        <Button className="w-full" onClick={() => alwaysOn.stop()} size="sm" variant="destructive">
          {v.stop}
        </Button>
      )}
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
      {/* P1D-2: wake-word always-on toggle (D3: wake gates entry, open-mic
          VAD inside the window, PTT above stays the manual override). */}
      <label className="flex items-center gap-1.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        <input
          checked={alwaysOnPref}
          onChange={event => $voiceAlwaysOn.set(event.target.checked)}
          type="checkbox"
        />
        {v.alwaysOn}
      </label>
      {wakeState === 'listening' && (
        <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{v.wakeHint}</p>
      )}
      {wakeState === 'loading' && (
        <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{v.wakeLoading}</p>
      )}
      {wakeState === 'error' && (
        <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-red)">{v.wakeFailed}</p>
      )}
      {/* P1D-2 data gathering: capture without barging in, so the mic is hot
          while Piper is audible — measures Chromium AEC leakage (ADR-0008). */}
      <label className="flex items-center gap-1.5 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        <input
          checked={echoTest}
          onChange={event => $voiceEchoTest.set(event.target.checked)}
          type="checkbox"
        />
        {v.echoTest}
      </label>
      <Button onClick={() => voiceClient.disconnect()} size="sm" variant="ghost">
        {v.disconnect}
      </Button>
    </div>
  )
}
