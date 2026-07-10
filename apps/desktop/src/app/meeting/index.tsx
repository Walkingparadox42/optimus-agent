import { useStore } from '@nanostores/react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { meetingRecorder } from './recorder'
import { $meetingElapsed, $meetingError, $meetingLastNote, $meetingPhase } from './store'

/**
 * [Optimus Cockpit] Meeting recorder controls — M1.
 *
 * A record button in the avatar pane. Click to start mic-only recording,
 * click to stop; on stop the recording uploads to the voice service, which
 * batch-transcribes, asks Hermes to summarize it, and writes the meeting note
 * to BotVault. Lives in the avatar pane alongside the voice controls.
 */

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60

  return `${m}:${String(s).padStart(2, '0')}`
}

export function MeetingControls() {
  const { t } = useI18n()
  const m = t.meetingPanel
  const promptResolverRef = useRef<null | ((value: string) => void)>(null)
  const [purpose, setPurpose] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const phase = useStore($meetingPhase)
  const elapsed = useStore($meetingElapsed)
  const lastNote = useStore($meetingLastNote)
  const error = useStore($meetingError)

  const recording = phase === 'recording'
  const busy = phase === 'uploading' || phase === 'transcribing'

  const requestPurpose = () =>
    new Promise<string>(resolve => {
      setPurpose('')
      setPromptOpen(true)
      promptResolverRef.current = resolve
    })

  const finishPrompt = (value: string) => {
    const resolve = promptResolverRef.current
    promptResolverRef.current = null
    setPromptOpen(false)
    resolve?.(value.trim())
  }

  const label =
    phase === 'recording'
      ? `${m.stop} · ${mmss(elapsed)}`
      : phase === 'prompting'
        ? m.prompting
      : phase === 'uploading'
        ? m.uploading
        : phase === 'transcribing'
          ? m.transcribing
          : m.record

  return (
    <div className="flex w-full max-w-64 flex-col items-center gap-1.5 px-4">
      <Button
        className={cn('w-full', recording && 'ring-2 ring-(--ui-red)')}
        disabled={busy || phase === 'prompting'}
        onClick={() =>
          void (recording
            ? meetingRecorder.stop(requestPurpose)
            : meetingRecorder.start())
        }
        size="sm"
        variant="secondary"
      >
        <Codicon name={recording ? 'debug-stop' : 'record'} size="0.8125rem" />
        {label}
      </Button>
      {promptOpen && (
        <form
          className="flex w-full flex-col gap-1.5 rounded border border-(--ui-stroke-secondary) bg-(--ui-sidebar-background) p-2"
          onSubmit={event => {
            event.preventDefault()
            finishPrompt(purpose)
          }}
        >
          <label className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
            {m.purposePrompt}
          </label>
          <Input
            autoFocus
            onChange={event => setPurpose(event.target.value)}
            placeholder={m.purposePlaceholder}
            value={purpose}
          />
          <div className="flex gap-1.5">
            <Button className="flex-1" size="sm" type="submit" variant="secondary">
              {m.useContext}
            </Button>
            <Button className="flex-1" onClick={() => finishPrompt('')} size="sm" type="button" variant="ghost">
              {m.skipContext}
            </Button>
          </div>
        </form>
      )}
      {error === 'mic-denied' ? (
        <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-red)">{m.micDenied}</p>
      ) : error ? (
        <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-red)">{error}</p>
      ) : null}
      {lastNote && phase === 'idle' && (
        <p className="w-full truncate text-center text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
          {m.saved}: {lastNote.split('/').pop()}
        </p>
      )}
    </div>
  )
}
