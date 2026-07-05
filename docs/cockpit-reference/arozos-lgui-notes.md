# ArozOS "LGUI" joint human/AI desktop — concepts worth imitating

Concept-level notes from a read-only look at `/root/scratch/joshu-oss`. No code copied.
The point of interest: Joshu's "Language Graphical User Interface" — a desktop that a
human **and** an agent operate *simultaneously* on the same surface — and what of that
is worth stealing for a hand-built cockpit UI. (Not recommending the box; harvesting
ideas only.)

**The one idea:** don't make the agent drive a human UI by screen-scraping; build the UI
so both operators go through the **same action layer**, and let each app expose its state
and its verbs in machine-readable form. The agent and the human are two clients of one
surface, not one puppeteering the other (`README.md`, "Cloud Desktop (LGUI)" section).

Six transferable concepts:

1. **Shared surface, not remote control.** A voice/agent session *attaches to a surface*
   and emits state onto it as events; the human UI subscribes to the same stream. The wire
   vocabulary is tiny and explicit — `assistant_delta` / `assistant_done` (agent text),
   `think_job_start`, `desktop_action`, `app_action` (`src/voiceSurfaceSync.ts:11-25`). The
   comment there is the whole thesis: "jChat consumes these today; future desktop shells can
   subscribe the same way." For a cockpit: define one event stream the agent writes and the
   UI renders, so the agent's work *appears on screen* live instead of in a side channel.

2. **"One handler, many wires."** An app's action is written once and reachable identically
   from a button, a cron job, an MCP tool, or the agent (`docs/platform-architecture.md`,
   "One handler, many wires"; unified `POST /api/apps/:id/invoke`). The human clicking and
   the agent calling hit the *same* code path — so state can't diverge between operators.
   This is the structural reason joint operation stays consistent.

3. **Declared verbs + a state snapshot per app.** Each app ships a manifest declaring its
   agent-callable actions and GUI actions, plus a `getGuiSnapshot()` returning current view
   state (`activeView`, a `listPreview`, etc.) so the agent is grounded in *what's on screen
   right now* (`docs/platform-architecture.md`, "embedded app cookbook":
   `agent.guiActions[]`, `getGuiSnapshot()`). In the voice bridge this snapshot is passed
   through at session start and on `register_surface` (`browserRealtimeSession.ts:109-149`).
   Cockpit takeaway: every panel should expose (a) a short list of verbs and (b) a compact
   "here's my current state" snapshot the agent can read before acting.

4. **Purpose-built for joint operation.** The README's framing — a desktop built *for both*
   rather than an AI fighting a mouse-and-eyes UI — is the design north star. Concretely it
   means: stable element/action ids, machine-readable state, and verbs that don't depend on
   pixel layout. A hand-built cockpit gets this for free if I design the action layer first
   and the pixels second.

5. **Co-presence: screen for detail, voice for summary.** When the agent does real work it
   streams the full answer onto the surface and *speaks only a brief co-present summary*,
   explicitly told "details are on screen" (`src/speechPresentation.ts:8-14`;
   `browserRealtimeSession.ts:718-747` streams deltas to the surface, then injects a short
   spoken summary). The division of labor — rich detail visually, terse confirmation
   audibly — is exactly right for a cockpit with a screen and a mic.

6. **Surface identity ≠ transport identity ≠ conversation identity.** The design keeps three
   ids distinct: the attached surface/app, the voice transport session, and the chat/agent
   thread (`browserRealtimeSession.ts:80-82`, `:134`; surface `threadId` vs `sessionId`).
   That separation is what lets the same agent conversation follow the user across surfaces.
   Worth copying so a cockpit can re-attach panels without dropping the agent's thread.

**What to leave behind:** the actual ArozOS shell is a patched third-party Go desktop
(GPLv3, `vendor/arozos` + `patches/arozos/`) carrying a full windowing/desktop metaphor I
don't need. I'm not imitating the *desktop* — I'm imitating the **contract**: shared event
stream + one action layer + declared verbs + per-panel state snapshot + co-present
voice/screen split. That contract is UI-framework-agnostic and drops straight into a
hand-built cockpit.
