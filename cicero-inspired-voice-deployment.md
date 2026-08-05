---
title: Cicero-Inspired Voice Deployment
created: 2026-07-23
type: project
status: incubating
priority: medium
owner: shared
tags: [optimus, voice, cicero, desktop, latency, phase-4]
---

# Cicero-Inspired Voice Deployment

## Decision

**Borrow the interaction patterns; do not deploy Cicero as a second voice platform.**

Cicero is a credible, active self-hosted voice interface for agent harnesses and has a verified Hermes ACP adapter. It is not the right primary stack for Optimus: it duplicates Hermes session/agent orchestration, introduces a Bun daemon plus managed speech sidecars, and its default CUDA-oriented stack would contend for Urithiru's shared RTX 3060.

The current target remains the **Optimus Desktop renderer on MiniPC .146** as the trusted voice/UI client, with **Hermes CT115 (.116)** as the agent, tools, memory, and orchestration system of record.

## Verified local baseline

- CT115 faster-whisper `tiny.en` is installed/cached and measured at **0.28 s** for a 2.4-second speech clip with built-in Silero VAD.
- Therefore replacing STT wholesale is not expected to deliver a meaningful win; Cicero's default `large-v3-turbo` would likely regress without dedicated CUDA capacity.
- The likely remaining latency is endpointing, Hermes first-token/tool-loop time, TTS generation, and playback start.

## Patterns to adopt in Optimus Desktop Phase 4

1. **Semantic end-of-turn detection**
   - Use a lightweight Smart-Turn-style classifier alongside VAD.
   - Goal: commit clearly finished speech quickly while preserving long-form mid-thought pauses.
   - Keep a fixed silence ceiling as the fallback when the model is unavailable.

2. **Instant acknowledgement plus streamed speech**
   - Play a local, pre-rendered acknowledgement while Hermes is producing the first response.
   - Begin playback sentence-by-sentence as soon as TTS has the first completed sentence.
   - This improves perceived responsiveness; it does not disguise a failed or indefinitely stalled tool turn.

3. **Turn identity and barge-in correctness**
   - Every input, agent event, TTS chunk, playback event, and cancellation must carry a session/turn or generation epoch.
   - A new utterance cancels playback and invalidates all late frames from the interrupted turn.
   - Preserve the existing Cockpit design principle: interrupted turns cannot create ghost audio or stale side-effect progress claims.

4. **Speech-gated hands-free VAD**
   - Combine energy/VAD with a compact local speech classifier so music, taps, and keyboard noise do not open a voice turn or trigger barge-in.
   - Maintain echo suppression / mic pause during TTS and restart listening only after playback has drained.

5. **Measure before optimizing**
   - Record per-turn timestamps: speech end, transcript ready, Hermes first token/progress, first completed sentence, first TTS audio byte, playback start, and turn complete.
   - Track p50/p95 and failure/cancellation rate before selecting models, moving GPU workloads, or adding speculative execution.

## Optional experiments — gated

- **Semantic endpointing pilot:** first implementation target; compare normal VAD vs semantic turn handling using Steve's long-form speaking style.
- **Speculative turn start:** only after endpointing is reliable. A Cicero-style approach may save roughly 300–600 ms by beginning work before final audio closure, but must never send an incomplete thought or bypass confirmation states.
- **Local TTS upgrade:** benchmark against the current Piper path; do not claim an improvement until first-audio and quality are measured on the actual MiniPC/CT115 route.

## Explicit non-goals

- Do not deploy Cicero's Telegram-call sidecar.
- Do not add its separate daemon, lanes/office abstraction, local router model, or conversation persistence layer.
- Do not place new persistent GPU voice workloads on the shared RTX 3060 without a contention plan.
- Do not revive the retired CT115 bespoke Cockpit service; carry its protocol lessons into the current Hermes Desktop renderer only.

## Sources

- Cicero repo and architecture: https://github.com/5uck1ess/cicero
- Cicero semantic turn detection: https://github.com/5uck1ess/cicero/blob/main/docs/turn-detection.md
- Cicero Hermes ACP adapter: https://github.com/5uck1ess/cicero/blob/main/docs/brains.md
- Cicero performance caveats: https://github.com/5uck1ess/cicero/blob/main/docs/performance-portability-evaluation.md
- Existing BotVault STT decision: `Optimus/projects/incubating/sts-stt-pick.md`
- Current implementation boundary: Optimus Desktop Phase 4 / voice protocol
