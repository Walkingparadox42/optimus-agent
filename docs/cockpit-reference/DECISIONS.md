# Optimus Cockpit - Decisions (ADR log)

This is the canonical architecture decision record for the local-Joshu / Electron /
cascaded-voice build. One global number space.

Numbering note: ADR-0001 is the pre-pivot standalone record
docs/decisions/ADR-0001-hybrid-unreal-web-workspace.md (Hybrid Unreal + Web). It is
retained for history and SUPERSEDED by ADR-0010 below. New decisions are logged here
from ADR-0002 onward so the number space stays unique across the repo.

Rules: do not re-litigate an Accepted decision. If you believe one is wrong, add a
new superseding ADR that references it; do not silently diverge in code or docs.

Provenance: ADR-0002 through ADR-0009 are formalized from the BotVault planning docs
(optimus-cockpit-local-joshu-architecture.md and -deployment-plan.md, both dated
2026-07-01). ADR-0010 through ADR-0012 also draw on the Joshu-OSS parts-harvest notes
in docs/reference/ (P0.6, 2026-07-04).

---

## ADR-0002: Cascaded streaming voice pipeline, not native audio-to-audio STS | Status: Accepted | 2026-07-04

### Context
Joshu-OSS uses a native speech-to-speech cloud model (OpenAI Realtime / Gemini Live)
where one model owns VAD, STT, reasoning, and TTS. That model only "calls tools"
because the provider wires them in. Optimus must keep tool-calling, MCP access, and
BotVault retrieval, and must stay local/LAN-only with no cloud audio model.

### Options considered
- Native audio-to-audio model (local or cloud): lowest latency, but reasoning lives
  in the audio model, so Hermes tools/MCP/BotVault are not first-class; cloud options
  also leak audio off-LAN.
- Cascaded pipeline (STT to Hermes Agent to TTS): reasoning stays in the Hermes
  Agent, so all existing tools/skills/memory/BotVault work unchanged; more moving
  parts and we own barge-in ourselves.

### Decision
Cascaded streaming pipeline: faster-whisper STT, Hermes Agent /v1/responses for
reasoning and tools, espeak-ng/Piper TTS. Do not wire the cockpit as if the voice
layer were native STS.

### Consequences
- Tool-calling, MCP, and BotVault retrieval are preserved because the brain is Hermes.
- We own VAD, endpointing, streaming, and barge-in at every seam (see ADR-0005/0006).
- Reference: docs/reference/voice-bridge-notes.md documents the transport/interrupt
  shape we borrow from Joshu's bridge while replacing its engine.

---

## ADR-0003: Persistent WebSocket voice session on :9125 replaces the legacy :9122 /turn | Status: Accepted | 2026-07-04

### Context
The current running voice service is the synchronous HTTP `optimus-sts-bridge` on
:9122 POST /turn: full audio in, ffmpeg, faster-whisper full transcript, Hermes,
full espeak-ng WAV, base64 out. It cannot do partial STT, streaming TTS, early
playback, or real barge-in. Stopping playback of an already-generated WAV is a fake
interrupt.

### Options considered
- Keep extending /turn: simplest, but structurally cannot stream or barge-in.
- New persistent WS session service on a separate port: enables partials, early
  playback, and real interrupts; more work; two services during migration.

### Decision
Build a new persistent WebSocket voice session service on :9125 as the cockpit voice
spine. Keep :9122 /turn untouched as a legacy smoke/health endpoint during and after
migration.

### Consequences
- The cockpit main voice path is WS on :9125; :9122 is smoke only and stays running.
- Migration is incremental (Phase 1A-1D) without breaking the existing proof endpoint.
- Config default voice_ws_port: 9125; verify no port conflict before binding.

---

## ADR-0004: Binary WebSocket frames for local PCM audio, not base64-in-JSON | Status: Accepted | 2026-07-04

### Context
Joshu sends all audio as base64 inside JSON envelopes and explicitly disables
permessage-deflate, because a reverse proxy sits between the browser and their voice
service and mangles binary frames. Our transport is direct on the LAN with no proxy
in the audio path.

### Options considered
- Base64-in-JSON (Joshu's choice): one parse path, easy to log, but about 33 percent
  size overhead and wasted CPU on every mic/TTS frame; only needed because of a proxy
  we do not have.
- Binary WS frames for PCM, JSON text frames for control/events: efficient, natural
  for raw PCM; requires a small framing convention so IDs/epoch travel with audio.

### Decision
Binary WS frames carry PCM audio; JSON text frames carry control and events. The
framing convention for binary audio (header carrying generation_epoch and sequence)
is specified in docs/voice-protocol.md.

### Consequences
- Lower latency and CPU than base64. We are not proxy-constrained, so no reason to
  copy Joshu's base64 workaround.
- Binary frames need a header so barge-in can discard stale audio by epoch (ADR-0005);
  spelled out in the protocol spec.

---

## ADR-0005: generation_epoch plus session/turn/response IDs on every server message | Status: Accepted | 2026-07-04

### Context
On barge-in, TTS chunks, text deltas, and tool events from the interrupted turn are
still in flight. Without a discriminator, they play as ghost audio or fire as ghost
tool events after the user has moved on.

### Options considered
- Rely on timing/ordering to drop stale output: fragile, races on the network.
- Tag every server-to-client message with stable IDs and a monotonic epoch; discard
  anything from an older epoch: robust, cheap, borrowed from the voice-bridge notes
  (their responseSeq / inFlight / turn-id guard).

### Decision
Every server-to-client voice message carries session_id, turn_id, response_id, and
generation_epoch. A voice.interrupt increments generation_epoch on the server. The
client discards any TTS chunk, text delta, or tool event tagged with an older epoch,
unless a tool result already committed.

### Consequences
- Deterministic stale-output defense at every seam of the cascade.
- Binary audio frames must carry at least generation_epoch and sequence in a header
  (ADR-0004, docs/voice-protocol.md).
- Enables the barge-in mechanic in ADR-0006 and the side-effect safety in ADR-0007.

---

## ADR-0006: Barge-in mechanic - cancel, truncate to playback high-water mark, clear buffer, truncate logged transcript | Status: Accepted | 2026-07-04

### Context
Real barge-in requires the duplex WS session (ADR-0003). When Steve interrupts, we
must stop fast AND keep the conversation transcript honest: Hermes should believe it
said only what Steve actually heard, not the full generated response.

### Options considered
- Stop local playback only: leaves queued CT115 chunks and a transcript that claims
  the whole answer was delivered; context drifts from reality.
- Full mechanic borrowed and adapted from the voice-bridge notes: cancel in-flight,
  truncate the assistant turn to the actual playback position, clear the client audio
  buffer, and truncate the LOGGED transcript to what actually played.

### Decision
On barge-in: (1) cancel or discard the in-flight upstream response (per the Phase 0
cancellation answer, ADR pending in PROGRESS.md), (2) truncate the assistant turn to
the TTS playback high-water mark (the samples actually emitted to the speaker), (3)
clear queued TTS on both MiniPC and CT115 and bump generation_epoch, (4) truncate the
logged transcript to that high-water mark so Hermes context matches what Steve heard.

### Consequences
- The MiniPC must track a playback high-water mark (our local analogue of Joshu's
  Twilio mark / elapsed-ms truncation), not just a play/stop flag.
- Whether the upstream Hermes stream is cancellable server-side is an open question
  (Phase 0 task 7); until answered, treat interrupted turns as "may still complete
  side effects" and rely on ADR-0007.

---

## ADR-0007: Interrupted-turn side-effect safety | Status: Accepted | 2026-07-04

### Context
Discarding deltas client-side does not stop server-side tool execution. An interrupted
turn could still run a side-effecting tool call (BotVault write, config change,
deployment, homelab command) that Steve arguably preempted by interrupting.

### Options considered
- Trust the epoch discard alone: only prevents ghost output on the client, not
  server-side writes.
- Gate side-effecting tool calls during voice sessions and suppress/hold stale-epoch
  actions: safe by construction regardless of upstream cancellation support.

### Decision
During voice sessions, side-effecting tool calls remain confirmation-gated unless the
turn completed uninterrupted with explicit intent. Side-effecting actions carrying a
stale generation_epoch are suppressed or held for confirmation. An interrupted turn
must never silently continue writing. This rule holds from Phase 1A onward and stands
regardless of how the upstream cancellation question resolves.

### Consequences
- Read-only/idempotent tool calls can flow; writes need explicit uninterrupted intent
  or an approval.
- The upstream cancellation behavior must still be observed and documented (Phase 2
  task 10), but this rule does not depend on it.

---

## ADR-0008: Echo handling - mic stays live during TTS; AEC target; raised VAD acceptable first proof; pausing capture is banned | Status: Accepted | 2026-07-04

### Context
Barge-in is impossible if the mic is paused while Optimus is speaking. But a live mic
during TTS picks up Optimus's own audio and can self-trigger.

### Options considered
- Pause mic during TTS: trivially stops echo, but destroys barge-in by construction.
  Banned. (Note: the legacy web PTT path did exactly this; the WS voice service must
  not.)
- AEC with a loopback reference of what the MiniPC is playing (WebRTC AEC3 /
  speexdsp): correct, but can become a Windows/Python swamp.
- Raised VAD/wake threshold during SPEAKING under known test conditions: lower
  fidelity, but preserves barge-in and is cheap for a first proof.

### Decision
The mic stays live during TTS. AEC with a loopback reference is the target. A raised
VAD threshold during SPEAKING is acceptable for the first proof and is not a Phase 1
blocker. Pausing capture during TTS is explicitly banned as an echo fix.

### Consequences
- AEC work is isolated so it cannot stall the first working voice loop.
- Media ducking of other apps (Core Audio session APIs, per-app to ~18 percent, never
  Optimus's own session) is a related but separate MiniPC concern (Phase 2).

---

## ADR-0009: espeak-ng first, Piper swap isolated to a later phase | Status: Accepted | 2026-07-04

### Context
Changing transport/protocol and TTS engine at the same time makes debugging a swamp:
you cannot tell a transport bug from an engine bug.

### Options considered
- Start on Piper for quality: nicer voice, but couples engine bugs to the protocol
  bring-up.
- Start on espeak-ng behind a swappable TTS provider interface, add Piper as a second
  provider only after streaming is proven: one variable at a time.

### Decision
Use espeak-ng for the first streaming proof (Phase 1), behind a swappable TTS provider
interface. Piper is a later, isolated swap (Phase 1.5) with the same interface and no
concurrent protocol changes.

### Consequences
- Phase 1B chunked-TTS work stays on espeak-ng; do not swap to Piper mid-phase.
- Piper becomes selectable via config with no code changes; espeak-ng stays selectable
  for debugging.

---

## ADR-0010: Electron with bundled Chromium for the cockpit shell; not ArozOS; not Tauri | Status: Accepted | 2026-07-04 | Supersedes ADR-0001

### Context
The cockpit needs a windowed, resizable desktop shell that shows browser work, files,
transcript, and events, without Edge/WebView2 as the runtime foundation and without
Unreal as the critical path. We evaluated ArozOS (Joshu's desktop engine) during the
parts-harvest.

### Options considered
- ArozOS (Joshu's shell): would wrap the entire cockpit inside a browser tab of a
  multi-user web OS, and drags in a bundled Hermes that force-binds :8642 plus a
  host-wide GBrain that would clobber our setup (see ADR-0011). Wrong shape for a
  single-user native cockpit.
- Tauri: light, but reintroduces the system WebView2 dependency we explicitly
  rejected (Edge/WebView2 as foundation).
- Unreal-first (the old ADR-0001 direction): strongest presence feel, but awkward for
  browser/document/secret workflows and it became a hardware-verification swamp.
- Electron with bundled Chromium: windowed/resizable, no Edge dependency, bundles its
  own Chromium, reuses the existing web cockpit UI.

### Decision
The cockpit shell is Electron with bundled Chromium. Not ArozOS, not Tauri, not
Unreal-first. Unreal may return later as an optional presence layer once the local
Joshu core works.

### Consequences
- Supersedes ADR-0001 (Hybrid Unreal + Web). The Unreal scaffold under unreal/ is
  frozen as non-critical-path, not deleted.
- Electron hardening applies: strict preload bridge, no Node in renderer, CSP,
  LAN-only scoped tokens.
- We can imitate the ArozOS "LGUI" contract (shared event stream, one action layer,
  declared verbs, co-present screen/voice split) without adopting its shell. See
  docs/reference/arozos-lgui-notes.md.

---

## ADR-0011: Joshu-OSS is MINE-FOR-PARTS, do not deploy | Status: Accepted | 2026-07-04

### Context
Joshu-OSS is the closest reference to what we are building. We read it end to end
(P0.6). It is architecturally hostile to our environment and constraints.

### Options considered
- Deploy/adopt the Joshu box: fastest apparent path, but it bundles and force-binds
  its own Hermes on :8642 (colliding with our CT115 Hermes), installs a host-wide
  GBrain that clobbers ours, sends file/memory content to cloud embedding APIs
  (leaks BotVault content off-LAN), has cloud-only voice, and carries AGPL-3.0 + a CLA.
- Mine for parts: keep our own Hermes/GBrain/Honcho substrate and borrow only design
  patterns, written in our own words (AGPL + CLA means no verbatim code).

### Decision
Do not deploy or adopt Joshu-OSS. Harvest patterns only. Keep our own
Hermes/GBrain/Honcho substrate. The harvest outputs are the docs/reference/*.md notes.

### Consequences
- No Joshu code enters this repo. Patterns are re-expressed in our own words.
- Reference notes: voice-bridge-notes.md, connectors-mirror-notes.md,
  arozos-lgui-notes.md, camofox-notes.md.
- Cloud embeddings and cloud voice are specifically rejected on the data-locality
  constraint (BotVault content stays local; cloud LLM text is acceptable, cloud
  audio/embeddings of private content is not).

---

## ADR-0012: Phase 6 browser viewport transport - VNC/noVNC vs CDP screencast | Status: PROPOSED | 2026-07-04

### Context
Phase 6 streams a CT115-controlled browser into the cockpit and hands control to Steve
for auth/2FA. The transport choice determines how the human-input handoff works. This
must be decided before Phase 6 starts. Reference: docs/reference/camofox-notes.md.

### Options considered
- VNC/noVNC (Joshu/Camofox approach): a headed browser streamed as a framebuffer.
  Gives a free human-input plane - the human drives the real browser directly over VNC,
  and those keystrokes never pass through the agent or get logged, which makes auth
  handoff clean. Costs: heavier stream, fixed resolution, must run a headed browser.
- CDP screencast (Page.startScreencast + Input.dispatch): lighter, DOM-coordinate
  fidelity, no VNC server. But it does not bundle a human-input path, so we must build
  and secure the "human types directly, agent never sees it" handoff ourselves.

### Decision
UNRESOLVED. Proposed, not Accepted. Decide before Phase 6. The deciding factor is the
auth/2FA handoff: VNC gives credential isolation for free; CDP is lighter but requires
us to re-create that isolation guarantee explicitly.

### Consequences
- Phase 6 cannot start until this ADR is Accepted.
- Either way, apply the two Camofox credential-safety corrections from the harvest:
  also gate the agent's evaluate/submit verbs (Joshu leaves evaluate unhooked), and
  invert Joshu's login-context heuristic so we capture LESS page content on auth pages,
  plus mount a persistent browser profile volume (Joshu's local sidecar loses cookies
  on container removal). See docs/reference/camofox-notes.md and PROGRESS.md Phase 6.
