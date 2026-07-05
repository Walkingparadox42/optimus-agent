# Voice bridge reference notes — Joshu `packages/voice-realtime`

Design notes only, written from a read-only inspection of the AGPL repo cloned at
`/root/scratch/joshu-oss`. No code was copied. These describe the **transport and
interrupt shape** worth imitating for a hand-built WS voice protocol.

**Their stack vs mine (read this first):** Joshu's bridge is a thin relay in front
of a **cloud speech-to-speech** model (OpenAI Realtime or Gemini Live). That single
upstream owns VAD, STT, the LLM turn, and TTS all at once. Mine is a **local
cascade** (faster-whisper → Hermes Agent → espeak-ng/Piper on a 3060), so I own
every stage myself. What transfers is the **WS envelope, the session state machine,
and the barge-in/stale-audio discipline** — not the engine. Every section below ends
with a "for my cascade" translation.

Primary files: `src/index.ts` (WS server), `src/browserRealtimeSession.ts` (browser
protocol + interrupt logic), `src/twilioRealtimeSession.ts` (PSTN variant),
`src/voiceS2sTypes.ts` (client interface), `src/openaiRealtimeClient.ts` (upstream
adapter), `src/audioResample.ts` / `src/audioMulawCodec.ts` (codecs),
`src/userInputGate.ts` (transcript gating).

---

## 1. Transport model at a glance

- One HTTP server, one WS upgrade path with aliases: `/media`, `/voice-rt/media`,
  `/voice/media` (`src/index.ts:56`, `:54` for `/health`).
- **Everything is JSON text frames**, including audio. Audio bytes are base64-encoded
  into a `payload` string field of a JSON envelope — there are *no* binary WS frames.
  This is a deliberate simplification (one parse path, easy to log/proxy) at the cost
  of ~33% base64 overhead (`src/index.ts:132-135`, all `ws.send(JSON.stringify(...))`).
- `perMessageDeflate: false` is set explicitly because the browser WS is proxied
  (8788 → 8792) and deflate corrupts frames / triggers RSV1 1002 closes
  (`src/index.ts:97-99`). **Imitate this** — permessage-deflate + realtime audio is a
  known footgun through a reverse proxy.
- Auth is a shared secret checked at upgrade time, accepted either as `?token=` query
  or as a trailing path segment `/media/<secret>`, compared in constant time
  (`src/index.ts:66-81`, `:115-122`; `safeEqualToken` in `src/safeEqual.ts`). Failing
  the check calls `socket.destroy()` before the WS is even established.

**For my cascade:** keep the JSON-envelope-with-base64-audio design for control-heavy
prototyping, but I should send **microphone and TTS audio as binary WS frames** (raw
PCM / Opus) and reserve JSON frames for control. faster-whisper wants 16 kHz PCM and
Piper emits 22.05 kHz PCM — base64 round-tripping that at frame cadence is wasted CPU.
A clean split: binary frame = audio, text frame = control/event. Keep their upgrade-time
shared-secret check verbatim in spirit.

---

## 2. WS session lifecycle

**Connect → identify transport → session object → teardown.**

1. **Upgrade** (`src/index.ts:101-127`): validate path, feature-enabled, and token;
   strip `sec-websocket-extensions`; `wss.handleUpgrade`.
2. **Transport is inferred from the first message**, not the URL (`src/index.ts:130-179`):
   a `browser_start` event ⇒ browser transport; a `connected`/`start` event ⇒ Twilio
   PSTN transport. Until then `transport = "unknown"`. One socket handler, two dialects.
3. **Session start**: constructs a `BrowserRealtimeSession(ws)` and calls
   `handleStart(voiceSessionId, chatSessionId, {...})` (`src/index.ts:146-168`). Note the
   **two ids**: a `voiceSessionId` (defaults to `web:<timestamp>`) and a separate
   `chatSessionId`/`surfaceSessionId` used to correlate with the chat/agent thread
   (`browserRealtimeSession.ts:80-82`, `:185-186`). Keeping voice-transport identity
   separate from conversation identity is worth copying.
4. **Upstream connect happens lazily inside the session**, after tool/surface bootstrap
   (`browserRealtimeSession.ts:191-281`): it builds the system prompt + tool list, then
   `createVoiceS2sClient(...).connect()`. When the upstream signals ready, the session
   emits `{event:"browser_ready"}` to the client and moves to `listening`
   (`:223-231`).
5. **Teardown** is idempotent and multi-path: client can send `browser_stop`
   (`index.ts:204-207`), or the socket `close` fires (`index.ts:267-273`); both call
   `session.close()`, which aborts any in-flight brain job and closes the upstream
   (`browserRealtimeSession.ts:292-297`). Sends are guarded by `ws.readyState !== 1`
   everywhere (`:801-804`) so a late event after close is a no-op, not a throw.

**Session state machine** (`browserRealtimeSession.ts:48`): `listening → thinking →
speaking` (`SessionState`), pushed to the client on every transition as
`{event:"state", state}` (`:796-799`). The client UI is driven entirely off these
three states.

**For my cascade:** adopt the same skeleton — (a) upgrade+auth, (b) a `hello`/`start`
control frame that carries session id + capabilities, (c) an explicit server→client
`ready`, (d) a broadcast `state` enum. My states map cleanly:
`listening` (faster-whisper capturing) → `thinking` (Hermes generating) →
`speaking` (Piper streaming out). Keep the "one socket, ready signal, state
broadcasts, idempotent close" shape exactly.

---

## 3. Message / frame types

All are `{event: "<name>", ...}` JSON. Names below are their wire vocabulary (facts,
not code).

**Client → server (browser dialect)** (`src/index.ts:139-207`):
| event | payload | meaning |
|---|---|---|
| `browser_start` | `sessionId`, `chatSessionId`, `appId?`, `voiceCommands?`, `threadId?`, `guiSnapshot?` | open session |
| `register_surface` | `appId`, `voiceCommands`, `threadId?`, `guiSnapshot?` | attach/refresh the UI surface the agent can act on |
| `browser_audio` | `payload` = base64 PCM24k | one uplink mic chunk |
| `browser_interrupt` | — | client-confirmed barge-in (client already passed a local RMS gate) |
| `browser_stop` | — | close session |

**Server → client** (`browserRealtimeSession.ts`):
| event | payload | meaning |
|---|---|---|
| `browser_ready` | `sessionId`, `provider` | upstream connected |
| `state` | `state` | listening/thinking/speaking |
| `user_transcript` | `text`, `partial` | recognized user speech |
| `browser_audio_out` | `payload` base64, `format:"pcm24k"` | one TTS output chunk |
| `tts_end` | — | end of a spoken response's audio |
| `clear_audio` | — | **flush the client's playback buffer now** (barge-in) |
| `barge_in` | — | notify UI a barge-in happened |
| `assistant_delta` / `assistant_done` | `text` | stream agent text to the on-screen surface |
| `think_job_start` | — | slow (agent) path started |
| `desktop_action` / `app_action` | action descriptors | agent is driving the shared UI |
| `error` | `message` | |

The `assistant_*` / `*_action` events are the **surface-sync** sub-protocol
(`src/voiceSurfaceSync.ts`) — see the LGUI notes; they let the agent's work render on
screen in parallel with (or instead of) speech.

**Twilio/PSTN dialect** differs because it must speak Twilio Media Streams' own vocab:
`connected`, `start` (carries `streamSid`/`callSid`/`customParameters`), `media`
(`payload` base64 μ-law + `timestamp`), `mark`, `stop` (`src/index.ts:211-260`). The
`mark` mechanism is central to PSTN barge-in — see §5.

**For my cascade:** this event vocabulary is almost directly reusable. I'd keep
`ready`, `state`, `user_transcript` (with `partial` for faster-whisper interim
results), `audio_out` + `tts_end`, `clear_audio`, `barge_in`, `error`. Drop the cloud-
specific `register_surface`/tool plumbing unless I build a shared UI. The one thing I
gain by owning the cascade: I can emit **`partial` transcripts continuously** from
faster-whisper, which their design can't do cleanly because the cloud model hides
partial STT.

---

## 4. Audio framing & chunking

- **Uplink**: browser sends PCM16 mono @ 24 kHz base64 (`browser_audio` → 
  `appendPcm24kB64`, `browserRealtimeSession.ts:283-285`). PSTN sends μ-law @ 8 kHz.
- **Rate conversions** are explicit and centralized (`src/audioResample.ts`): linear
  interpolation resampler between 8k/16k/24k; browser 24k → Gemini's native 16k; μ-law
  8k → 16k for the upstream; upstream 24k PCM → μ-law 8k for Twilio. μ-law codec is a
  thin wrapper over `alawmulaw` with a note that v6 is CJS and needs a default-import
  shim under ESM (`src/audioMulawCodec.ts:1-11`).
- **Downlink batching** is the detail worth stealing (`browserRealtimeSession.ts:299-330`):
  output PCM deltas from the model are accumulated into `pcmOutAcc` and only flushed to
  the client in fixed **9600-byte frames** (`PCM_OUT_BATCH_BYTES`, `:43`). A tail flush
  emits the remainder (byte-aligned to even/sample boundary) then sends `tts_end`. This
  trades a tiny latency floor for far fewer, evenly-sized WS frames — steadier client-
  side playback and less per-frame overhead. 9600 bytes @ PCM16/24kHz ≈ 200 ms of audio.

**For my cascade:** keep the **fixed-size output batching** idea (accumulate Piper
output, flush in ~100–200 ms frames, byte-align to the sample size, send an explicit
end marker). Ignore all the μ-law/resample matrix unless I add a phone path — locally
I control every rate, so I'd pin one internal rate (16 kHz for STT, whatever Piper's
voice emits for TTS) and resample once at the edges. The "even-byte-align before you
frame PCM16" guard (`:320`) is a real bug-avoider worth copying.

---

## 5. Barge-in / interruption (the important part)

Two independent triggers converge on one `applyBargeIn` routine
(`browserRealtimeSession.ts:363-377`):

1. **Client-confirmed** — the browser did a local RMS/energy gate and sent
   `browser_interrupt` (`index.ts:200-203` → `handleInterrupt` → `applyBargeIn("client")`).
2. **Server VAD** — the upstream reports the user started speaking
   (`onSpeechStarted` → `handleSpeechStarted`, `:332-338`).

**Gating before honoring a barge-in** (`:332-338`, and PSTN `:516-540`): only treat
speech as barge-in when `sessionState === "speaking"` — i.e. only while the assistant
is actually playing audio. Speech while `listening` is just the next turn, not an
interrupt. There's a second gate: during a slow "think" job, casual chatter does *not*
interrupt progress ticks or the final answer playback (`:336`, `:532-538`) — only
"organic" (small-talk) speech is interruptible.

**What `applyBargeIn` does, in order** (`:363-377`):
1. Tell the upstream to cancel the in-flight response (`cancelActiveResponse()`).
2. **Truncate the assistant's current item to 0 ms** (`truncateItem(lastAssistantItem, 0)`)
   so the model's server-side memory of "what I said" is clipped — otherwise the model
   thinks it said a whole sentence the user never heard.
3. Drop the local output buffer (`pcmOutAcc = empty`).
4. Send `clear_audio` to the client → **flush its playback buffer immediately** (audio
   already sent over the wire but not yet played must be discarded, or the user hears
   the tail of an interrupted sentence).
5. Send `barge_in` (UI signal), discard the partial assistant transcript, reset speech
   reason, return to `listening`.

**PSTN barge-in is subtler** because Twilio buffers audio and reports playback via
`mark` acks (`twilioRealtimeSession.ts:258-259, 375-385, 542-556`):
- Every outbound response chunk is followed by a `mark`; Twilio echoes the mark back
  when that audio has *played*. An unshifted `markQueue` ⇒ audio still playing.
- On barge-in it computes how much was actually heard:
  `elapsedMs = latestMediaTimestamp − responseStartTimestampTwilio`, then
  `truncateItem(lastAssistantItem, elapsedMs)` — truncating to the *real* playback
  position, not 0. It also sends Twilio a `clear` event to dump the buffer, then resets
  `markQueue` and `responseStartTimestampTwilio` (`:544-556`, `clearOutbound` `:841-845`).
- After the greeting it deliberately clears mark state so the first caller turn isn't
  misread as a barge-in (`:500-504`).

**For my cascade:** this maps almost perfectly and is the single most valuable pattern
to copy. My barge-in = (1) `abortController.abort()` on the in-flight Hermes generation,
(2) **stop Piper immediately and drop everything queued behind it**, (3) send
`clear_audio` so the client dumps un-played TTS, (4) go back to `listening`. My
advantage: I don't need `truncateItem` against a remote model's hidden memory — *I*
own the conversation transcript, so I just record "assistant said «only the words Piper
actually finished playing»". To do that accurately I need Piper's playback position,
which is the local analogue of Twilio's `mark`/`elapsedMs` trick: **track how many TTS
samples have actually been emitted to the output device**, and truncate the logged
assistant turn to that boundary. Keep the two-trigger design (client energy gate +
server VAD) and the "only interrupt while speaking" gate.

---

## 6. Turn / response / sequence identifiers used to discard stale audio

The upstream adapter maintains identifiers so late/duplicate events from a cancelled
response don't leak (`src/openaiRealtimeClient.ts`):

- **`responseSeq`** — a monotonic counter bumped on every `response.create`
  (`:57`, `:321-322`). Each spoken response is tagged with its seq when it starts
  (`onResponseStarted({reason, seq})`, `:366-370`).
- **`pendingResponseReason`** — set when a response is *requested*, consumed when the
  provider actually starts it (`:58-59`, `:323`, `:368-369`). This tags *why* the
  assistant is speaking: `organic | function_output_ack | hermes_inject | progress |
  reprompt` (`voiceS2sTypes.ts:48-53`). The session uses that reason to decide what's
  interruptible and to detect the "spoke a guess before calling think" antipattern
  (`browserRealtimeSession.ts:340-361`).
- **`responseInFlight`** — a boolean guard so `cancelActiveResponse()` only fires
  `response.cancel` when something is actually generating (`:60`, `:301-306`). Cancel is
  a no-op otherwise (avoids racing a cancel against an already-finished response).
- **`lastAssistantItem` / `itemId`** — the id of the currently-playing output item,
  captured from output-audio deltas (`browserRealtimeSession.ts:99`, `:303`). This is
  the handle passed to `truncateItem` on barge-in. Cleared after use so a stale
  truncate can't fire twice (`:366-369`).
- On the browser session, `activeSpeechReason` + `responseHadSpeech` +
  `realtimeTurnSettled` + `turnThinkRequested` + `lastBrainHandledQuote` together form
  the **de-dup guard** that stops the same user utterance from spawning two agent jobs
  when transcripts arrive late or out of order (`:88-98`, `beginUserTurn` `:566-595`,
  `reconcileThinkAfterResponseDone` `:630-659`). The recurring shape: *stamp each unit
  of work with an id, and on every late callback check `if (job.jobId !== currentId)
  return;`* (e.g. `:719`, `:723`, `:760`).

**For my cascade:** I need my own version of all of this because a cascade has *more*
seams where stale audio leaks (STT emitting a final after I've moved on; Hermes tokens
arriving after abort; Piper frames queued after barge-in). Concretely:
- One **monotonic `turnId`** per user utterance. Tag STT results, the Hermes request,
  and every TTS frame with it. Any callback whose `turnId` ≠ current is dropped. This is
  their `responseSeq`/`jobId` guard, and it's the backbone of not-speaking-stale.
- An **`inFlight` guard** around the Hermes generation so abort is a no-op when nothing
  is running.
- Track the **TTS playback high-water mark** (samples emitted) as my `truncateItem`
  analogue, so my logged transcript matches what the user actually heard.
- Keep a lightweight **reason tag** per spoken response (e.g. `answer | progress |
  ack`) so I can make progress fillers non-interruptible while the real answer is.

---

## 7. Time-to-first-audio / streaming worth imitating

- **Dual fast/slow path** (their headline idea, `browserRealtimeSession.ts` throughout).
  Casual turns are answered instantly by the always-connected upstream; anything needing
  tools/files/real work is dispatched to a slow "think" job against Hermes over an
  **SSE-streamed** OpenAI-compatible endpoint (`src/brainThink.ts:87-101` posts to
  `/v1/chat/completions` with `stream:true` and reads SSE deltas `:153-194`). The agent
  text streams to the *screen* immediately (`assistant_delta`) while a short spoken
  summary is injected only at the end.
- **Immediate acknowledgement, then filler cadence.** When a think job starts, it
  injects a 2-word spoken "One moment." right away (`:550`, `:554`), then a
  **progress-tick state machine** speaks short fillers ("Still checking.", "Almost
  there.") on a timer while Hermes works (`JobProgressState`, `:49-56`,
  `scheduleProgressTick`/`fireProgressTick` `:418-443`), escalating to "taking longer
  than usual" after a max tick count (`:431-435`). Fillers are constrained by prompt to
  2–4 words so they don't collide with the real answer (`openaiRealtimeClient.ts:233-236`).
- **Fixed-size output batching** (§4) keeps first-audio latency low but steady.
- **Transcript gating before committing to a response** (PSTN, `src/userInputGate.ts`):
  classifies a transcript as `empty | unclear | clear`; filler-only / noise-marker /
  <2-letter transcripts get a short reprompt instead of a full (slow, expensive) turn.
  Cheap guard against burning a whole turn on "uh".

**For my cascade:** the **immediate-ack + progress-filler** pattern is gold and I own
it more cheaply — Piper can speak "one sec" the instant Hermes starts, and I can gate
fillers on a timer until the first real token arrives. The **SSE token streaming from
Hermes → start TTS on the first sentence boundary** is the key TTFA win: don't wait for
the full Hermes answer, chunk on punctuation and pipe each sentence to Piper as it
completes. The **transcript gate** (drop "uh"/silence before waking Hermes) is directly
reusable and saves a full cascade round-trip. The dual-path split is less relevant to me
because *my* single path already routes through Hermes — but the *shape* (fast filler
voice concurrent with slow real work) is exactly what a cascade needs to not feel dead
for the 2–5 s Hermes takes.

---

## 8. Where their approach explicitly won't apply to me

| Their assumption | Why it doesn't transfer | My local equivalent |
|---|---|---|
| Cloud model owns VAD, STT, LLM, TTS in one socket | I have four separate local stages to sequence and interrupt myself | My orchestrator wires faster-whisper → Hermes → Piper and owns every seam |
| `truncateItem` clips a **remote** model's hidden memory | My transcript is local; nothing hidden to clip | Truncate my own logged turn to the TTS playback high-water mark |
| Barge-in = `response.cancel` to a provider | No provider to cancel | `AbortController` on Hermes + hard-stop Piper + flush output queue |
| μ-law 8k / PCM24k resample matrix, Twilio `mark` acks | Cloud/PSTN artifacts | Pin one internal PCM rate; use the OS audio callback as my playback clock |
| STT partials are invisible (can't stream interim text) | — | I *can* stream faster-whisper partials as `user_transcript{partial:true}` |
| `injectAssistantMessage` makes the S2S model *speak* my text | No S2S model | I send text straight to Piper |
| "spoke-before-think" antipattern (model guesses then corrects) | Only exists because one model both chit-chats and calls tools | My cascade only speaks after Hermes returns; the failure mode doesn't exist |

**Net:** borrow the WS envelope + `ready`/`state`/`clear_audio`/`barge_in` vocabulary,
the "identify transport/capabilities from the first frame" idea, the two-trigger
gated barge-in, the monotonic turn-id stale-guard, fixed-size output batching, and the
immediate-ack + progress-filler cadence. Leave behind everything that exists only
because the engine is a remote all-in-one model.
