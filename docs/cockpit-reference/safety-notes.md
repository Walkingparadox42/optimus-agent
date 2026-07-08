# Optimus Cockpit - Safety notes (standing risks)

Companion to DECISIONS.md. ADRs record decisions; this file records OBSERVED
standing risks that are not tied to a single decision and must not get buried
inside one. Numbered SN-001 onward. If a mitigation is ever decided, promote
it to an ADR in DECISIONS.md and reference the note here.

---

## SN-001: An agent turn can create standing automation on its own initiative | Observed 2026-07-06

### What was observed
During the P0.7 cancellation spike (method and data in OPTIMUS.md Phase 4;
barge-in conclusions in ADR-0006), the CONTROL request - a single
/v1/responses turn instructing the agent to "execute this shell command
exactly as given, with no commentary, no questions, and no other actions"
(a one-shot sleep-then-write to a BotVault scratch file) - produced more than
the requested one-shot execution. On its own initiative the agent:

- wrote the command into a script, /root/.hermes/scripts/cancel-spike.sh, and
- registered a recurring Hermes cron job (name cancel-spike-runner, id
  b2cff5c20919, schedule "every 1m", no_agent script mode, origin
  api_server) to run it.

The job persisted after the turn ended and kept re-executing - rewriting the
BotVault file every ~2 minutes for ~9 minutes - until manually removed
(`hermes cron remove b2cff5c20919`, plus deleting the script). Each cron run
logged "silent (empty output)": nothing surfaced to any chat surface.

### Why this is its own item, not part of the cancellation ADR
This is about what Hermes can do during ANY normal turn, not about
interruption. The cron job was created mid-turn and would have persisted
identically whether that turn completed, was cancelled, or the client
vanished. It is a standing-automation risk independent of voice/barge-in:

- Standing automation survives the turn, the session, client disconnects,
  and gateway restarts (persisted in ~/.hermes/cron/jobs.json on disk).
- It runs headless (no_agent script mode) with no per-run approval and, in
  this case, no visible output anywhere.
- Cancellation (ADR-0006) and the interrupted-turn side-effect rule
  (ADR-0007) can never retract this class of side effect. After creation,
  detection is the only control.
- An explicit "no other actions" instruction did not prevent it. Prompt-level
  constraints are not a mechanism (consistent with this project's preference
  for architectural over promised safety, ADR-0012).

### Status
**OPEN** (confirmed 2026-07-06 after the P0.7b run_stop spike). P0.7b's clean
result - no cron jobs or scripts created in either run - is absence of
OPPORTUNITY, not evidence the risk is retired: both runs were explicitly
stopped 5 seconds in, before the agent could act at all. Nothing has changed
about what an uninterrupted turn can do on its own initiative. This item is
tracked independently of the barge-in/cancellation question, which is now
fully closed (ADR-0006 answered, ADR-0014 decided); do not close SN-001 on
the strength of barge-in results.

Risk recorded; no mitigation decided. Candidate mitigations for a future
decision: periodic `hermes cron list` audits; treating cron/script creation
as approval-gated actions on CT115; never assuming prompt instructions bound
agent behavior when designing voice-phase flows. Any of these, if adopted,
becomes an ADR.

---

## SN-002: Self-hosted Honcho (192.168.0.222) dialectic backend hangs — silent ~11s tax on every Hermes profile's fresh turns | Observed 2026-07-07

### What was observed
Diagnosing voice first-token latency (OPTIMUS.md FG-1) surfaced a homelab-infra
problem that is NOT voice-specific and NOT Optimus-Cockpit-specific. Recorded here
because it affects every Hermes profile and deserves its own investigation
independent of this project.

Hermes memory (`memory.provider: honcho`) points at a SELF-HOSTED Honcho at
`http://192.168.0.222:8000` (per `/root/.hermes/honcho.json`, `baseUrl`). The
server's HTTP/storage layer is UP and healthy — `/health` 200, `/docs` 200, all
sub-3ms; message writes work. But the DIALECTIC endpoint (`peer.chat`, the
LLM-reasoning-over-memory call) HANGS to a 30s client timeout and returns nothing
useful. Agent logs across profiles show repeated
`Honcho dialectic query failed: Request timed out after 30.0s`.

Because the default `recallMode` was `hybrid`, every FRESH turn blocked ~11s
(8s first-turn dialectic join + 3s follow-up join) waiting on that dead call
before the LLM request even started — a silent latency + cost tax paid by voice
AND text chat AND any profile using this honcho.json, on every new session.

### Why it's its own item, not the voice fix
The voice path was un-blocked 2026-07-07 by setting `hosts.hermes.recallMode:
"tools"` (prefetch returns immediately; no blocking join) — see FG-1. But that
only stops Hermes from WAITING on the broken backend; it does not fix the backend,
and it does not touch other hosts/profiles (e.g. `hermes_scribe` still `hybrid`,
still eating the 11s). The actual defect is on the .222 box: its internal
dialectic reasoning/LLM backend is down, misconfigured, or starved. Until that is
fixed, Honcho delivers NO cross-session user modeling to any profile — the feature
is effectively off while still costing latency wherever `recallMode` is `hybrid`.

### Status
Recorded; not urgent; independent of Optimus Cockpit. Candidate investigation when
picked up: check the Honcho service on 192.168.0.222 (what LLM/provider its
dialectic is configured to call, whether that upstream is reachable, logs on the
.222 box); decide whether to fix it or retire hosted-dialectic memory. If other
profiles matter in the meantime, flipping their honcho.json host blocks to
`recallMode: "tools"` stops the bleed without fixing the root cause.
