# CLAUDE.md — Optimus Cockpit (Hermes Desktop fork)

## What this is

This directory is `apps/desktop` inside a fork of NousResearch/hermes-agent
(github.com/Walkingparadox42/optimus-agent). The fork is the ENTIRE upstream
monorepo (agent core, gateway, CLI, skills, etc.) because GitHub can only fork
whole repos — but we only work in `apps/desktop`. Everything else in the repo
is inert vendor code: never run it, never modify it, ignore it.

Goal: turn this Electron + React desktop app into "Optimus Cockpit" — a
Joshu-like local agent workspace. We are ADDING to this working app, not
building from scratch:
- Avatar/presence pane: simple animated headshot reacting to voice state
  (idle/listening/thinking/speaking/tool-use). No 3D, no rigging.
- Browser access pane: Camofox-driven, agent-controlled, human-takeover-capable
  browser viewport (design reference: docs/reference notes, see below).
- Files/BotVault pane: extend the existing file browser to show BotVault
  content specifically.
- Voice: a NEW WebSocket connection to a voice session service on CT115
  (port 9125, protocol TBD-being-built-separately) running ALONGSIDE this
  app's existing tui_gateway WebSocket connection — not replacing it.

## Environment facts

- This machine: MiniPC (SW-MINIVAC), Windows, username Steve. Local dev only.
- Backend: Hermes runs on CT115 (192.168.0.116), NOT on this machine. This app
  must run in "remote backend" mode, pointed at CT115's Hermes over the LAN
  (HERMES_API_URL / equivalent remote config — find the actual mechanism in
  this codebase, don't assume).
- Do NOT install/run a local Hermes backend on the MiniPC. This app is a
  client only.
- Voice backend (:9125 WS service) is being built separately on CT115. It does
  not exist yet as of this session. Do not assume it's reachable.
- LAN service hosts (LXCs on Urithiru) this project talks to directly:
  - CT115 (192.168.0.116): Hermes backend; voice WS :9125 (planned).
  - CT117 (192.168.0.117): MCPO.
  - CT119 (192.168.0.119, "search-services", static reservation): SearXNG;
    planned optimus-browser-bridge (Playwright verb API :9126, noVNC
    websocket :9127; Phase 6, see OPTIMUS.md). Ports proposed, not yet bound.
  Cross-host calls are plain LAN egress; nothing routes through the MiniPC.
- The rest of this forked repo (agent/, gateway/, providers/, skills/, etc.)
  is vendor code we do not run. If asked to "start Hermes" or similar, that
  means the REMOTE CT115 instance, never a local install from this repo.

## Ground rules

1. Read-and-report before modify: for the first few sessions, prioritize
   understanding the existing app (component structure, state management,
   how it talks to the backend, remote-auth-token flow) before changing code.
2. One well-scoped task per session. Don't sprawl into unrelated refactors.
3. Never touch anything outside apps/desktop/ in this repo.
4. Never commit secrets, API keys, or tokens. Check .env handling before
   touching auth-related code.
5. Executor honesty: if a task turns out to require something outside this
   machine's/this session's reach (e.g. CT115-side changes, voice backend
   that doesn't exist yet), say so explicitly and stop — don't paper over it
   with a plan that assumes it exists.
6. Steve's style: terse, copy-paste-ready commands, no em dashes, no emojis.
7. This is a fork of an actively maintained upstream project (MIT licensed).
   Prefer additive changes (new components/panels) over modifying shared/core
   files, to keep future upstream merges easier where reasonably possible.

## Reference material (NOT in this repo yet — flag if you need them)

Design/decision docs currently live on CT115 at
/root/projects/optimus-cockpit/docs/ — this MiniPC session cannot read them
directly. If you need them (voice protocol spec, Camofox integration notes,
architecture decisions), say so and Steve will copy the relevant file(s) into
this repo under docs/cockpit-reference/ rather than guessing at their content.

## Current status

Investigation phase. No cockpit features have been added yet. First task is
mapping the existing app's architecture (see first prompt).
