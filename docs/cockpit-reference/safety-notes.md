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
