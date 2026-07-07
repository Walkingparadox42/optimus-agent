# Optimus Cockpit - Voice Session Protocol (:9125)

Status: LIVING SPEC. This is the interface contract that Phase 1A/1B/1C/1D and the
MiniPC wake/audio client all build against. It will change as checkpoints land; change
it here, in one place, and note the change.

Design reference: docs/reference/voice-bridge-notes.md (P0.6 parts-harvest from
Joshu-OSS). We borrow the transport, the ID/epoch discipline, the barge-in shape, and
the progress-filler cadence. We do NOT borrow the engine: Joshu's backend is a cloud
native speech-to-speech model; ours is a local cascade (faster-whisper to Hermes Agent
to espeak-ng/Piper). See ADR-0002.

Decisions this spec implements: ADR-0003 (WS on :9125), ADR-0004 (binary PCM frames),
ADR-0005 (IDs + generation_epoch), ADR-0006 (barge-in mechanic), ADR-0007 (interrupted
side-effect safety), ADR-0008 (mic live during TTS), ADR-0014 (Hermes surface =
/v1/runs).

**SURFACE CORRECTION (2026-07-06, ADR-0014): every mention of Hermes
"/v1/responses" in earlier copies of this spec is superseded. The voice service
drives Hermes via /v1/runs - POST /v1/runs (submit), GET /v1/runs/{run_id}/events
(SSE), POST /v1/runs/{run_id}/stop (barge-in cancel). /v1/responses has no explicit
cancel endpoint and cannot implement ADR-0006 barge-in. Do not build against it.**

Relationship to docs/architecture/event-protocol.md: that document defines the broad
cockpit event families (voice.*, agent.*, tool.*, browser.*, botvault.*, workspace.*,
avatar.*, system.*) that CT115 fans out to the cockpit UI via the Hermes bridge. THIS
document is narrower: the raw WS voice session wire contract between the MiniPC
wake/audio client and the CT115 voice service on :9125. Voice session events map onward
into the voice.* / agent.* / tool.* families for the UI feed.

---

## 1. Transport

- WebSocket, CT115, port 9125. LAN-only. No proxy in the audio path.
- Two frame kinds on the one socket:
  - Binary frames: PCM audio (mic uplink and TTS downlink). ADR-0004.
  - Text frames: JSON control and event messages.
- permessage-deflate is off (deflate corrupts binary audio framing). We do this
  because it is correct for raw PCM, not because of a proxy.
- Audio format (v0.1): PCM 16-bit signed, mono, 16 kHz. One internal rate; resample at
  the edges only if a provider needs it.

### 1.1 Binary frame header (FIRM — approved Steve 2026-07-06 after P1B/P1C exercised both kinds in production)

Binary frames cannot carry JSON fields, but ADR-0005 requires the epoch to travel with
the audio so stale chunks can be dropped. Proposed fixed 16-byte little-endian header,
then raw PCM payload:

```
offset size field
0      4    magic  = "OVX1" (0x4F 0x56 0x58 0x31)
4      1    kind   = 1 mic-uplink, 2 tts-downlink
5      1    flags  = bit0 last-chunk-of-response
6      2    reserved
8      4    generation_epoch (uint32)
12     4    seq (uint32, per-response for TTS, per-utterance for mic)
16     ...  PCM payload
```

session_id, turn_id, and response_id are bound to the connection and the most recent
JSON control message; the binary header carries the two fields needed at audio speed
(generation_epoch for stale-discard, seq for ordering/gap detection). The header
layout, the message set, the four-ID rule, and the barge-in sequence are all FIRM
(ADR-backed; header approved 2026-07-06 with both kinds exercised in production).

---

## 2. Common fields on every server-to-client message

Per ADR-0005, every server-to-client message (JSON, and via the header for binary)
carries:

- session_id: stable for the life of the WS voice session.
- turn_id: one user utterance and the assistant response to it.
- response_id: one assistant response within a turn (a re-prompt starts a new one).
- generation_epoch: monotonic uint32. Bumped on every voice.interrupt. The client
  discards any chunk/delta/tool event with an epoch older than the current one, unless
  a tool result already committed.

Client-to-server messages echo session_id (and turn_id where known) so the server can
correlate.

---

## 3. Client to server messages

| message | frame | payload | meaning |
|---|---|---|---|
| session.start | JSON | session_id, mode, wake_source?, profile? | open a voice session; server allocates epoch 0 |
| audio.input.append | binary (kind=1) | PCM chunk + header | one mic chunk while the user speaks |
| audio.input.commit | JSON | session_id, turn_id | end-of-utterance marker (VAD/endpoint fired); server may also endpoint on its own STT |
| voice.interrupt | JSON | session_id | barge-in; server bumps generation_epoch and runs the barge-in sequence (section 6) |
| session.mode.set | JSON | session_id, mode | switch mode (see section 8) without tearing down the session |
| session.end | JSON | session_id | close the session; return to wake-only on the client |

Notes:
- The client does not have to send audio.input.commit if the server-side streaming STT
  endpoints the utterance itself; commit is the explicit path.
- voice.interrupt is the only message that changes the epoch.
- P1A ADDITION (2026-07-06, built; APPROVED Steve 2026-07-06): text.input | JSON | session_id, text - the
  text-turn path. P1A has no STT; in P1C, stt.final feeds this same internal path.
  Kept afterward as the debug/text entry point. Rule: at most one turn in flight
  per session; text.input while a turn is running is rejected with error (client
  must voice.interrupt first).
- P1B ADDITIONS (2026-07-06, built; APPROVED Steve 2026-07-06): session.start payload gains fillers_muted
  (bool, default false) - mutes progress fillers only, never answer audio
  (Steve decision 2026-07-06). voice.interrupt payload gains optional
  played_samples (int) - the client-reported playback high-water mark in
  samples; the server truncates the logged transcript to the sentences whose
  audio playback had started at that mark. Truncation applies even when the
  turn already completed service-side: audio is SENT at synthesis speed and
  played later, so a barge-in after response.done still truncates.
- P1C ADDITIONS/RULES (2026-07-06, built; APPROVED Steve 2026-07-06): kind=1 mic frames are accepted and
  buffered into the current utterance (PCM16 mono 16k; per-utterance seq, gaps
  logged). Mic frames arriving while a turn is IN FLIGHT are discarded
  server-side and counted: in P1C the barge-in signal is client-side only
  (voice.interrupt) - the client mic stays hot (ADR-0008) and its gate decides
  what is a barge-in; server-VAD barge-in is a later increment. voice.interrupt
  also discards any half-captured utterance. text.input during an active
  utterance is rejected. Silence-endpoint windows are mode-dependent (section
  8): listening_for_turn 1.2s, conversation_active 1.5s, session/followup 2.0s,
  default 1.5s; explicit audio.input.commit remains the primary path.

---

## 4. Server to client messages

All carry the four common fields (section 2).

| message | frame | payload | meaning |
|---|---|---|---|
| stt.partial | JSON | text | interim transcript while the user is still speaking |
| stt.final | JSON | text | committed transcript for the turn |
| agent.text.delta | JSON | text | one streamed token/segment of the assistant response (from the Hermes /v1/runs events stream per ADR-0014, consumed incrementally, never buffered to completion; delta granularity on the runs stream to be verified in Track 1) |
| tts.audio.chunk | binary (kind=2) | PCM chunk + header (seq-numbered) | one chunk of synthesized speech; playback starts on the first chunk |
| tts.playback.stop | JSON | reason | reason="barge-in": flush playback and the client audio buffer NOW. reason="end": no more frames are coming; let the buffer drain naturally (see P1D-1 note below) |
| tool.started | JSON | tool, args_summary (redacted) | a tool call began |
| tool.result | JSON | tool, result_summary (redacted), committed | a tool call finished; committed=true means its side effect already happened |
| response.interrupted | JSON | at_epoch | the response for this epoch was interrupted; discard anything older |
| response.done | JSON | status | the response finished normally; turn is complete |

Notes:
- agent.text.delta must be forwarded as Hermes streams it. Do not wait for the full
  response before emitting deltas or starting TTS.
- tool.result.committed is what ADR-0007 keys on: a committed side effect survives an
  epoch bump; an uncommitted one from a stale epoch is suppressed/held.
- P1A ADDITIONS (2026-07-06, built; APPROVED Steve 2026-07-06): session.ready | JSON | mode - server ack of
  session.start, carries epoch 0 (the bridge-notes "ready" signal); error | JSON |
  text - explicit failure surface (spec section 9: no silent dead air). response_id
  is carried as run_id on the wire: the Hermes /v1/runs run identifier is the real
  response handle and the cancellation handle (ADR-0014).
- P1A delta-granularity verification (was flagged in ADR-0014): the /v1/runs events
  stream DOES forward token-level text as message.delta events (api_server.py wires
  stream_delta_callback); confirmed live 2026-07-06. agent.text.delta streams as
  specced; no gap.
- P1D-1 STOP-SIGNAL SEMANTICS (2026-07-06, built; APPROVED Steve 2026-07-06 as
  spec): tts.playback.stop stays ONE signal on the wire, but the client's
  action depends on reason, because the service sends audio at synthesis speed
  (faster than realtime) - the buffer legitimately holds un-played tail when
  reason="end" arrives. reason="barge-in": flush playback and buffer
  immediately (audio dies NOW). reason="end": treat as a no-more-frames
  marker and let the buffer drain naturally - flushing here would amputate
  the end of every answer. A client that flushed on both would be wrong.
- P1C ADDITIONS (2026-07-06, built; APPROVED Steve 2026-07-06): stt.final gains endpoint_source
  ("commit" | "silence" | "max-length") so the client can tell which path
  closed the utterance. response.done gains status value "ignored" - emitted
  when the transcript gate (empty/too-short/filler-only, e.g. "uh") drops the
  utterance without burning a Hermes run; stt.final is still sent first.
- P1B ADDITIONS (2026-07-06, built; APPROVED Steve 2026-07-06): tts.filler | JSON | text, reason
  (ack|progress|long_wait) - announces that the following TTS audio (same epoch,
  own seq stream ending in a last-chunk flag) is a filler, not the answer.
  tts.playback.stop carries reason ("barge-in" | "end") and fires on BOTH
  barge-in AND normal turn end - the client treats stop as one signal
  regardless of cause (Steve decision 2026-07-06); on normal end it precedes
  response.done. The section 1.1 header is now exercised for kind=2
  (tts-downlink): the answer is one continuous seq stream across sentences,
  closed by an empty frame with the last-chunk flag; each filler utterance is
  its own seq stream. NOTE: frames are sent at synthesis speed, not realtime -
  playback pacing/buffering is the client's job, and played_samples reporting
  (section 3) is how truncation stays honest.

---

## 5. Turn lifecycle (normal, no interrupt)

```
client: session.start
client: audio.input.append (binary) ... repeated while speaking
server: stt.partial ... repeated
client: audio.input.commit   (or server endpoints)
server: stt.final
server: agent.text.delta ... repeated (streaming from Hermes)
server: tts.audio.chunk (binary) ... repeated, playback starts on chunk seq=0
server: tool.started / tool.result   (if the turn uses tools)
server: response.done
```

The session stays open across turns (Phase 2 keeps it open for follow-ups).

---

## 6. Barge-in sequence (ADR-0006, spelled out)

Trigger: the client detects Steve speaking during SPEAKING (mic is live per ADR-0008)
and sends voice.interrupt. Steps, in order:

1. Server increments generation_epoch (the single source of truth for staleness).
2. Server stops producing TTS for the old response and, per the Phase 0 cancellation
   answer, either cancels the in-flight Hermes stream or discards its remaining deltas
   server-side. (Cancellation support is the open Phase 0 task 7 question.)
3. Server truncates the assistant turn to the playback high-water mark: the number of
   TTS samples the MiniPC actually emitted to the speaker before the interrupt. This is
   our local analogue of Joshu's Twilio mark / elapsed-ms truncation. The client
   reports (or the server tracks) that high-water mark.
4. Server truncates the LOGGED transcript / Hermes context for that turn to the
   high-water mark, so Hermes believes it said only what Steve actually heard. Context
   stays honest.
5. Server clears its queued TTS for the old response and emits tts.playback.stop plus
   response.interrupted{at_epoch}.
6. Client, on tts.playback.stop: stop playback immediately and clear its local audio
   buffer. Client drops any buffered chunk/delta/tool event whose epoch is older than
   the new generation_epoch.
7. Side-effect safety (ADR-0007): any side-effecting tool call still arriving from the
   old (now stale) epoch is suppressed or held for confirmation, never silently run.
   Only tool.result with committed=true from before the interrupt stands.
8. Server begins the new turn (new turn_id) on Steve's incoming speech.

Never pause mic capture as part of this. The mic was live throughout (ADR-0008); that
is what made the barge-in possible.

---

## 7. Progress-filler state machine (Hermes latency cover)

Borrowed from docs/reference/voice-bridge-notes.md (Joshu's think-progress cadence).
Purpose: a cascade adds 2 to 5 seconds of Hermes/tool latency before the real answer;
do not let the cockpit go dead-air. State per turn:

1. On turn accepted (stt.final in, Hermes dispatched): immediately speak a short ack,
   for example "One moment." This is a 2 to 4 word filler, spoken via the normal TTS
   path but tagged as a filler response (its own response_id/reason) so it is
   interruptible and never mistaken for the answer.
2. If Hermes has not started streaming agent.text.delta after a first delay (default
   about 10 s from ack), speak one short filler from a small rotating set, for example
   "Still working on that." Keep each to a few words.
3. Repeat fillers on an interval (default about 10 s, measured from the end of the
   previous filler), up to a max tick count.
4. After the max ticks, speak a single longer-wait line, for example "This is taking a
   bit longer than usual," then stop filling and keep waiting.
5. As soon as real agent.text.delta arrives, cancel any pending filler timer and let
   the real answer stream. Fillers are always lower priority than the answer and must
   never overlap it.

Fillers are constrained to a few words by design so they do not collide with or delay
the real response. Steve barging in over a filler is a normal barge-in (section 6).

---

## 8. Session modes

mode is set at session.start and changed with session.mode.set. The MiniPC state
machine (Phase 2) owns the full set; the wire only needs the current mode value:

```
idle_wake_only
wake_ack
conversation_active
listening_for_turn
processing_turn
speaking
waiting_for_followup
session_active
sleeping
```

The server uses mode mainly for endpointing patience and follow-up behavior; longer
modes (conversation/session) use longer silence windows so short pauses do not commit
a turn early.

P1D-2 (2026-07-07, built): session.mode.set is now implemented on the service
(previously spec-only) and exercised by the always-on client, which reports
listening_for_turn on window open / utterance start, waiting_for_followup after
playback drains, and idle_wake_only on window close. The window policy itself is
ADR-0015: wake word opens the window (8s ack timeout), open-mic VAD runs inside it
(8s follow-up window after each answer), PTT overrides at any time. In
idle_wake_only, mic audio is consumed ONLY by the renderer-local wake engine -
no frames reach this protocol until wake fires.

---

## 9. Logging requirements (from Phase 1 task 5)

The service logs, with IDs and epoch, at least: wake detected, stt.partial/stt.final,
Hermes response_id, generation_epoch changes, tts chunk queued/sent, playback
started/ended, interrupt/barge-in, stale-event discards, and the upstream
cancel/discard result. Failures must be explicit; no silent dead air.

---

## 10. Open items tracked elsewhere

- ANSWERED 2026-07-06: upstream in-flight cancellation (was Phase 0 task 7). Explicit
  cancel exists ONLY on /v1/runs (POST /v1/runs/{run_id}/stop), verified TRUE_CANCEL
  (~5ms to run.cancelled, LLM call aborted). Step 2 of the barge-in sequence CANCELS
  via that endpoint; the voice service builds on /v1/runs per ADR-0014. ADR-0007
  still applies to tools already executing at stop time.
- Binary frame header layout (section 1.1): FIRM as of 2026-07-06 (Steve, P1C gate).
  Both kinds exercised in production - kind=2 tts-downlink (P1B), kind=1 mic-uplink
  (P1C).
- P1B filler phrasing (section 7, Claude's call per Steve 2026-07-06): ack "One
  moment."; rotation "Still working on it." / "Almost there." / "Hang on.";
  escalation "This is taking longer than usual." Fillers respect the per-session
  fillers_muted flag (section 3).
