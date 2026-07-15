# Optimus voice-service cockpit integrations

This directory holds the voice-oriented BotVault intent/resolution layer that
is deployed beside CT115's `/opt/optimus-voice-service/voice_service.py`.

The resolver accepts casual commands such as:

- `Call up the Val Dory note`
- `Pull up fishing boats`
- `Lemme see Optimus monetization`
- `Can you call up the latest pricing file?`

It does not require the user to say `BotVault`, `canvas`, or `pane`. Filename,
folder, recency, joined/split words, spelled letters, and common STT variants
are resolved locally. Low-confidence queries return no match instead of opening
an unrelated note.

After an underspecified request such as `open that in BotVault`, the service
keeps a 20-second follow-up window. A second utterance such as `the Val Dory
note` completes the open action.

## Patient Conversation Mode

`conversation_mode.py` is the endpointing policy behind the avatar's explicit
Conversation Mode button:

- The client opens the local VAD window immediately without a wake word.
- There is no initial-listening or follow-up timeout; the window remains open
  until the user switches the button off or presses Stop.
- Silence after speech begins waits 8 seconds, longer than every other mode.
- A single utterance can remain active for up to five minutes instead of the
  standard 30 seconds.
- Normal push-to-talk and wake-word modes keep their existing fast timings.

Before the VAD detects speech, microphone frames remain local to the desktop.
The 8-second server window begins only after intentional speech starts.

The full regression suite also exposed a faster-whisper edge case: a 0.5-second
`uh` sample sometimes hallucinated 7–23 words/numbers and bypassed the existing
filler regex. `transcript_gate.py` now rejects token rates that are physically
implausible for the audio duration while preserving plausible short replies.

## Deployed files on CT115

- `/opt/optimus-voice-service/botvault_voice.py`
- `/opt/optimus-voice-service/conversation_mode.py`
- `/opt/optimus-voice-service/transcript_gate.py`
- `/opt/optimus-voice-service/test_conversation_mode.py`
- `/opt/optimus-voice-service/test_transcript_gate.py`
- `/opt/optimus-voice-service/test_botvault_voice.py`
- `/opt/optimus-voice-service/smoke_botvault.py`
- `/opt/optimus-voice-service/smoke_conversation_mode.py`
- Patched `/opt/optimus-voice-service/voice_service.py`
- Backup: `/opt/optimus-voice-service/voice_service.py.bak-2026-07-15-voice-first-botvault`
- Backup: `/opt/optimus-voice-service/voice_service.py.bak-2026-07-15-conversation-mode`
- Backup: `/opt/optimus-voice-service/voice_service.py.bak-2026-07-15-transcript-gate`

## Verification

```bash
cd /opt/optimus-voice-service
venv/bin/python -m unittest -v test_botvault_voice.py test_conversation_mode.py test_transcript_gate.py
venv/bin/python smoke_botvault.py
venv/bin/python smoke_conversation_mode.py
venv/bin/python smoke_test.py
```
