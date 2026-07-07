# OPTIMUS.md — Progress log

Per CLAUDE.md: every phase's changes land here as a reviewable diff/decision
summary before Steve tests the gate. This file starts at the D1 decision
because that's where the informal testing landed before the formal log began.

---

## D1 — Backend locality: DECIDED

**Status:** Accepted
**Date:** 2026-07-05
**Decision:** (b) Remote — renderer connects to `hermes serve` on CT115
(192.168.0.116). CT115 remains the one Hermes of record.

### Evidence

Tested live against production CT115 Hermes via the stock app's built-in
remote-gateway setup (session token, entered through the normal first-run
wizard, no code changes):

- **Token auth:** works end to end. Connected, session shows `backend v0.17.0`
  in the status bar, no auth errors after initial connect.
- **Chat:** confirmed live — real conversation history, real skill responses
  (Hero System 6E skill fired correctly on an ambiguous query), reflects
  actual CT115 agent state, not a fresh/empty instance.
- **Voice:** confirmed working over the remote connection.
- **Cron jobs / skills / sessions:** all show real CT115 data (14 cron jobs,
  77 API sessions, 23 Telegram sessions, actual skill list) — not empty,
  not local-only.
- **File browser:** confirmed showing CT115's real filesystem, rooted at `/`
  (not the MiniPC's local disk). Verified by recognizing actual CT115 paths
  from today's session: `botvault-local-orphan-backup`, `gbrain-sources`,
  `scratch`, `projects/optimus-cockpit`.

### Open sub-decision (not blocking, revisit in the BotVault-panel phase)

The file browser is rooted at `/` on CT115 — full filesystem, not scoped to
BotVault specifically. Fine for now (single user, own LAN). When a dedicated
BotVault pane is built, decide then whether to scope it to
`/mnt/vaults/BotVault` specifically (cleaner, matches the doc's "workspace
app" framing, avoids exposing `.ssh`/`.hermes` config in a general file pane)
or keep using the generic rooted browser. Not a blocker for Phase 1.

### Note on process order

This D1 evidence was gathered informally while walking through the stock
app's first-run setup, before the Phase 0.5 spike was run as its own
deliberate step. The finding stands regardless of order. A short formal
Phase 0 stock-local run (below) closes the gap for the record.

---

## Phase 0 — Baseline: cleanup needed for a clean record

**Status:** WAIVED by Steve. The stock-LOCAL check below is intentionally
skipped: D1 is decided (remote/CT115), the app is a client-only shell that
never runs a local backend on the MiniPC (CLAUDE.md), and D1 was confirmed
against production CT115 with better evidence than a local run would give. The
local-mode steps are left below only as a historical record. Do not run them.

**Phase 0 gate:** WAIVED — local-mode check intentionally skipped per Steve's
decision. Superseded by the D1 remote evidence above.

<details>
<summary>Original Phase 0 local-mode plan (not executed, kept for record)</summary>

**Status:** Partially done, needs one clean re-run

What actually happened: `npm run dev` was run with `HERMES_HOME` pointed at
a sandbox dir, but the setup wizard's remote-gateway option was used instead
of stock local — meaning D1 got tested but Phase 0's specific gate (stock
LOCAL backend, zero variables) was never independently confirmed clean.

**To close Phase 0 properly:**

1. Fresh PowerShell window (clears any stray env vars from today's session).
2. ```powershell
   cd C:\optimuscockpit\apps\desktop
   $env:HERMES_HOME = "C:\optimuscockpit-sandbox2"
   npm run dev
   ```
3. When the setup wizard appears, choose LOCAL (stock spawn its own
   `hermes serve`), NOT remote-gateway-with-token this time.
4. Confirm the three original gate items:
   - Chat message round-trips.
   - File browser lists the sandbox workspace (should show sandbox-local
     files, NOT CT115's `/root`).
   - Voice mode completes one utterance.
5. Record pass/fail here.

This is low-stakes and mostly for the record — D1 is already decided from
better evidence. But it's worth 10 minutes so Phase 0's gate is honestly
checked rather than skipped.

**Phase 0 gate:** WAIVED (see above).

</details>

---

## Phase 0.5 — Fork hygiene + D1 spike

**Status:** DONE. Hygiene tasks completed 2026-07-05 by Claude Code; Steve
confirmed the live remote gate (chat / file browser / voice all work with
auto-update disabled) and approved D1. Cleared to start Phase 1.

### 1. Pinned baseline

Fork baseline pinned at:

- **Tag / describe:** `v2026.7.1-248-g7203898ce`
- **Commit:** `7203898ce47c9ab90e64866d6cff0e6e9ad8d1cc`
- **Branch:** `main`
- **Subject:** "Merge pull request #58350 from kshitijk4poor/salvage/dedup-tool-call-id"
- **Origin:** github.com/Walkingparadox42/optimus-agent.git

Nearest release tag is `v2026.7.1`; HEAD is 248 commits ahead of it.

### 2. Auto-update disabled (background check + Update button)

A single kill-switch guards each path; each logs a no-op line. Nothing was
deleted, so this is a clean revert (flip the switches to `false`).

**Privileged client self-update (Electron main) — `apps/desktop/electron/main.cjs`:**
- Added `const AUTO_UPDATE_DISABLED = true` (above `checkUpdates`).
- `checkUpdates()` — early-returns `{ supported: false, updateAvailable: false,
  behind: 0, ... }` and logs `[hermes][optimus] desktop self-update check
  disabled`. This is the git `ls-remote` probe that the `hermes:updates:check`
  IPC drives.
- `applyUpdates()` — early-returns `{ ok: false, error: 'disabled', ... }` and
  logs `... apply disabled`. This is the git-pull + rebuild + relaunch path the
  `hermes:updates:apply` IPC drives — the one that would clobber the pinned fork.

**Renderer poller + Update button actions — `apps/desktop/src/store/updates.ts`:**
- Added `const AUTO_UPDATE_DISABLED: boolean = true`.
- `startUpdatePoller()` — no-op + log. Kills ALL background checking at once:
  the on-mount check, the 30-minute `setInterval`, the window-focus re-check,
  and the connection-mode re-check (client + backend). Called once from
  `src/app/desktop-controller.tsx:264`.
- `applyUpdates()` (client target) — no-op + log.
- `applyBackendUpdate()` (backend target) — no-op + log. These two are the
  actions behind every Update button: the updates overlay install button
  (`src/app/updates-overlay.tsx:54`), the About panel "Update now"
  (`src/app/settings/about-settings.tsx:147` via `startActiveUpdate`), the
  command-palette entry (`src/app/command-palette/index.tsx:504`), and the
  backend-skew toast action.

**Heads-up for Steve:** in REMOTE mode the visible Update button targets the
*backend* (updates CT115's Hermes), and `applyBackendUpdate` is now disabled
too. That means you can no longer trigger a CT115 backend update from inside
the app; update CT115 via its own CLI (`hermes update` on CT115). If you'd
rather keep in-app backend updates while only blocking the client self-update,
set `AUTO_UPDATE_DISABLED = false` in `src/store/updates.ts` and leave the
`electron/main.cjs` switch `true` — that keeps the fork-hygiene teeth (no
client git-pull) while re-enabling the backend Update button.

**Tests:** three upstream test blocks in
`apps/desktop/src/store/updates.test.ts` (`applyUpdates terminal state`,
`applyBackendUpdate recovery`, `startUpdatePoller`) now assert behavior we
deliberately disabled, so they are `describe.skip`'d with a comment (not
deleted — keeps the upstream test intact for a future merge).

### 3. connection.json — kept pointed at CT115

Kept as-is (recommended option). D1 = remote is decided, the existing
connection already works against CT115, no reason to disconnect.

### Verification done this session (automated, in-session)

- `tsc -p . --noEmit` — clean (exit 0).
- `eslint` on the three changed files — clean (exit 0).
- `vitest run src/store/updates.test.ts` — 13 passed, 12 skipped, 0 failed.
- Diff confined to `apps/desktop/` (3 files); an incidental root
  `package-lock.json` churn from `npx` was reverted.
- Change-isolation check: edits touch only the update subsystem. The gateway
  connection (`use-gateway-boot.ts`, `store/gateway.ts`, the `hermes:api` REST
  proxy), the message-stream dispatcher, file-browser IPC (`hermes:fs:*`), and
  the voice hooks are untouched — so remote-mode chat / file browser / voice
  code paths are unchanged.

### Verification NOT done this session (needs Steve — interactive)

The three live remote-gate items require driving the GUI, the file tree, and a
microphone against live CT115. This session cannot drive a GUI/mic or read
rendered chat, so these are handed to Steve (executor-honesty, CLAUDE.md rule
5). Steps:

```powershell
cd C:\optimuscockpit\apps\desktop
npm run dev
```

Then confirm, in REMOTE mode (existing connection.json → CT115):
1. **Chat round-trip** — send a message, get a real CT115 response.
2. **File browser** — shows CT115 filesystem (e.g. `projects/optimus-cockpit`),
   not the MiniPC's local disk.
3. **Voice** — one utterance completes.
4. **Auto-update is off** — no "update available" toast appears; clicking
   Update (About panel / command palette) does nothing and writes an
   `[optimus] ... disabled` line to the console (renderer devtools) or
   `[hermes][optimus] ...` to the main log (`HERMES_HOME/logs/desktop.log`).

**Phase 0.5 gate:**
- Hygiene changes land + automated checks pass: **PASS** (above).
- Nothing broke in remote mode (chat / file browser / voice): **PASS**
  (Steve confirmed interactively 2026-07-05).
- D1 findings written up: **DONE** (above).

**Steve's D1 approval:** [x] Confirmed — remote/CT115, proceed to Phase 1.
**Steve's live remote-gate sign-off:** [x] Confirmed — chat / files / voice
still work with auto-update disabled.

Phase 0.5 gate PASSED. Phase 1 authorized.

---

## Phase 1 — Workspace shell / pane manager (workspaceMode flag)

**Status:** Increment 1 DONE. Implemented 2026-07-05 by Claude Code; Steve
confirmed the visual gate (toggle, independent layout memory, relaunch
persistence, stock untouched) same day.

**Scope Steve chose:** flag + re-dock existing panes **+ per-workspace layout
persistence** (workspace remembers its own pane open/width arrangement,
independent of stock mode, with per-pane toggles). Toggle via **command palette
+ Settings**. Default OFF; stock layout byte-for-byte unchanged when off.

### Design (additive, reuses the existing PaneShell — no parallel dock engine)

`workspaceMode` is a persisted boolean that swaps which localStorage bucket
backs the pane-state store. Entering workspace mode docks chat (centre) + file
browser + preview open; the workspace keeps its own pane arrangement separate
from stock. Because it reuses the existing `<Pane>`/`PaneShell` primitives, the
stock path is untouched. This flag is the seam later cockpit panes (avatar,
browser, BotVault) will hang off.

### Files

- **`src/store/workspace-mode.ts`** (new) — `$workspaceMode` persistent atom
  (`hermes.desktop.workspaceMode`, default false) + `setWorkspaceMode` /
  `toggleWorkspaceMode`. Subscribes itself to drive the pane-scope swap; seeds
  the workspace's default arrangement (sidebar + file browser + preview open)
  the first time it's entered.
- **`src/store/panes.ts`** — pane open/width state is now persisted per SHELL
  SCOPE. Stock bucket key is unchanged (`…paneStates.v1`); workspace uses
  `…paneStates.workspace.v1`. New `setPaneScope('stock' | 'workspace', seed?)`
  saves the outgoing bucket and loads (or seeds) the target; every consumer
  keeps reading the same `$paneStates` atom, so nothing else changed.
- **`src/app/command-palette/index.tsx`** — "Toggle workspace mode" entry in the
  Appearance group.
- **`src/app/settings/appearance-settings.tsx`** — Workspace Mode switch row
  (Settings > Appearance).
- **`src/app/desktop-controller.tsx`** — reads `$workspaceMode` (guarantees the
  store inits at boot so a persisted workspace scope restores on relaunch) and
  passes it to AppShell.
- **`src/app/shell/app-shell.tsx`** — `workspaceMode` prop → `data-workspace-mode`
  attribute on the shell root (styling/observability hook for later phases).
- **i18n** — `settings.appearance.workspaceModeTitle/Desc` and
  `commandCenter.toggleWorkspaceMode` added to all four locales (en/ja/zh/
  zh-hant) + `types.ts`.

### Verification done this session (automated)

- `tsc -p . --noEmit` — clean (this also validates all 4 locales match the i18n
  type, so no missing translations).
- `eslint` on all changed files — clean.
- `vitest src/store/panes.test.ts` — 13 pass, 1 fail. **The 1 failure is
  pre-existing on `main`** (`width override … not persisted` — the test predates
  a change that made `persist` include widthOverride; verified it fails
  identically on an unmodified checkout). Not caused by this work and not fixed
  here (upstream test drift, out of scope).

### Verification NOT done (needs Steve — interactive GUI)

This session can't drive the GUI. Gate steps (`npm run dev`, REMOTE mode):
1. **Toggle on** — command palette ("Toggle workspace mode") or Settings >
   Appearance > Workspace Mode. File browser + preview dock open around chat.
2. **Independent memory** — resize/close panes in workspace mode; toggle OFF;
   the stock layout is unchanged. Toggle back ON; the workspace arrangement you
   left is restored (the two modes remember their layouts separately).
3. **Persists across relaunch** — leave workspace mode on, quit, relaunch; it
   comes back up in workspace mode with its arrangement.
4. **Stock untouched** — with workspace mode OFF, the app looks/behaves exactly
   as before this change.

**Phase 1 gate (increment 1):**
- Additive changes land + automated checks pass: **PASS** (above).
- Visual/behavioral gate (steps 1-4): **PASS** (Steve confirmed interactively
  2026-07-05).

Increment 1 gate PASSED.

### Increment 2 — Avatar/presence pane (placeholder)

**Status:** DONE. Implemented 2026-07-05 by Claude Code (Steve picked option
(a)); Steve confirmed the visual gate same day — workspace mode toggles, file
browser shows the CT115 filesystem inside workspace mode, avatar pane renders,
voice works.

The first NEW cockpit pane, hanging off the workspaceMode seam. Per CLAUDE.md:
simple headshot reacting to presence state, no 3D, no rigging. Placeholder
visual = the BrandMark (DESIGN.md's sanctioned brand glyph) inside a
state-tinted ring + a state label; a real animated headshot swaps in later
without changing the seam.

**Presence states** (idle / listening / thinking / speaking / tool-use, plus
waiting / error) derive from signals the app already tracks — no new event
plumbing:
- thinking / tool-use / waiting / error — pet-activity atom + chat `$busy`
  (same signals, same stale-flag guard, as the floating pet).
- speaking — voice playback status (includes the TTS "preparing" phase).
- listening — a stub atom (`$avatarListening`); mic state lives inside
  composer hooks today, and the CT115 :9125 voice client will drive this flag
  in the voice phase. Until then the avatar never shows "Listening".

**Files:**
- `src/store/avatar.ts` (new) — `deriveAvatarState` (priority: error →
  speaking → listening → waiting → tool-use → thinking → idle) + `$avatarState`
  computed atom + the `$avatarListening` stub.
- `src/store/avatar.test.ts` (new) — 9 unit tests on the derivation.
- `src/app/avatar/index.tsx` (new) — the pane component (tokens only,
  `motion-safe` pulse on active states, i18n labels, `data-avatar-state` hook).
- `src/store/layout.ts` — `AVATAR_PANE_ID` + registration (closed in stock) +
  `toggleAvatarPaneOpen`.
- `src/store/workspace-mode.ts` — avatar seeded open in the workspace
  arrangement.
- `src/store/panes.ts` — `setPaneScope` now MERGES missing seed entries into an
  existing workspace bucket (instead of seeding only a brand-new one), so the
  avatar appears open in the workspace Steve already created during the
  increment-1 gate — and future cockpit panes will too — without clobbering
  saved arrangements.
- `src/app/desktop-controller.tsx` — `<Pane id="avatar">` wired outermost on
  the rail side (both orientations), `disabled` outside workspace mode so the
  stock layout never gains a column.
- Command palette — "Toggle avatar pane" (Appearance group). i18n: `avatarPane`
  section + `commandCenter.toggleAvatarPane` in all four locales + types.

**Verification done (automated):** tsc clean; eslint clean on all changed
files; vitest: 9/9 avatar tests pass (the only failure in the pane suite is
the pre-existing upstream `panes.test.ts` width-override drift documented under
increment 1).

**Visual gate (Steve, interactive):** `npm run dev`, workspace mode ON:
1. Avatar pane appears as the outermost rail column (headshot + "Idle").
2. Send a chat message — label/ring move through Thinking (and Using tools if
   a tool fires), then back to Idle.
3. Use read-aloud/voice playback — state shows Speaking while audio plays.
4. Command palette "Toggle avatar pane" closes/reopens it; the workspace
   remembers the choice.
5. Workspace mode OFF — no avatar pane anywhere in the stock layout.

**Phase 1 gate (increment 2):**
- Additive changes land + automated checks pass: **PASS** (above).
- Visual gate: **PASS** (Steve confirmed interactively 2026-07-05).

Increment 2 gate PASSED.

---

### Increment 3 — BotVault pane

**Status:** Implemented 2026-07-05 by Claude Code. Needs Steve's visual gate
(below).

**Decision trail:** Steve picked option A (BotVault pane), vault =
`magicnas\obsidian\botvault`. MiniPC probe showed `magicnas` doesn't resolve
locally, so the pane browses through CT115's mount. Steve confirmed the mount:
**`/mnt/vaults/BotVault`** (bind mount of MagicNAS
`/mnt/storage/obsidian/BotVault`, added via `pct set` on Urithiru; `ls` showed
the real tree: `.obsidian Dresden Optimus daily pricing weekly`). That path is
the pane root.

**Design:** a vault-scoped file tree docked next to the file browser in
workspace mode, pinned to `/mnt/vaults/BotVault` instead of following the
session cwd. One wrinkle discovered during build: the file browser's tree hook
(`use-project-tree`) keeps its state in a module-level singleton, so a second
simultaneous tree can't share it — the two panes would fight over one atom.
Per CLAUDE.md rule 7 the shared hook stays untouched; the vault pane gets its
own lean state hook and reuses the shared pieces that ARE instance-safe: the
`readProjectDir` IPC layer (path-keyed cache), the `TreeNode` shape, and the
prop-driven `ProjectTree` renderer + header/empty-state chrome. The two panes
look and behave identically; only the state container differs.

**Behavior:** activate file/folder inserts a composer inline ref (same as the
file browser); click-preview opens the preview rail; refresh + collapse-all
header actions; agent writes to the vault surface live (non-destructive
reconcile on the workspace-change tick); unreachable vault shows the standard
unreadable state and self-heals by retrying (3s cadence, plus a forced re-read
on gateway reconnect). In stock (non-workspace) mode the pane does not exist.

**Files:**
- `src/app/botvault/use-vault-tree.ts` (new) — `BOTVAULT_PATH` constant + the
  lean instance-local tree state (load/lazy-children/merge-reconcile/retry).
- `src/app/botvault/use-vault-tree.test.ts` (new) — 5 tests on the pure
  helpers (patch + merge semantics).
- `src/app/botvault/index.tsx` (new) — the pane, mirroring the file browser's
  chrome.
- `src/store/layout.ts` — `BOTVAULT_PANE_ID` + registration +
  `toggleBotVaultPaneOpen`.
- `src/store/workspace-mode.ts` — seeded open in the workspace arrangement
  (the seed-merge from increment 2 makes it appear in Steve's existing
  workspace automatically).
- `src/app/desktop-controller.tsx` — `<Pane id="botvault">` between the file
  browser and the avatar (both orientations), file-browser sizing,
  `disabled={!chatOpen || !workspaceMode}`.
- Command palette — "Toggle BotVault pane". i18n: `botvault` section +
  `commandCenter.toggleBotVaultPane`, all four locales + types.

**Verification done (automated):** tsc clean; eslint clean; vitest 14/14
(5 botvault + 9 avatar). Diff confined to `apps/desktop/` + OPTIMUS.md.

**Visual gate (Steve, interactive):** `npm run dev`, workspace mode ON:
1. BotVault pane appears next to the file browser, labeled "BotVault",
   showing the real vault tree (`.obsidian Dresden Optimus daily pricing
   weekly` — dotfolders may be filtered like the file browser filters them).
2. Expand folders, click a note — it inserts a composer ref; preview opens it.
3. Ask the agent to create a note in the vault — the new file appears in the
   pane without a manual refresh.
4. Command palette "Toggle BotVault pane" closes/reopens it.
5. Workspace mode OFF — no BotVault pane anywhere; file browser unchanged and
   still cwd-following in both modes.

**Phase 1 gate (increment 3):**
- Additive changes land + automated checks pass: **PASS** (above).
- Visual gate: **PARTIAL** (2026-07-05). Tree rendered correctly
  (Dresden/Optimus/daily/pricing/weekly), click-to-composer-ref worked.
  Live-update test FAILED: agent wrote a file to the vault (write succeeded,
  chat rendered it as a file-reference/tool-result element) but the pane did
  not refresh.

**Live-update investigation (same day):**
- The app has NO file watcher and NO polling, anywhere. "Live update" for
  every fs-mirroring surface (file browser, review pane, coding rail, vault
  pane) is inferred client-side from the chat stream: `tool.complete` events
  whose payload carries an `inline_diff` or whose tool NAME matches
  `/terminal|shell|exec|bash|command|write|edit|patch|replace|apply|create|delete|remove|move|rename|mkdir|format/i`
  bump `$workspaceChangeTick` (`src/store/workspace-events.ts:47`, fired from
  `src/app/session/hooks/use-message-stream/gateway-event.ts` in the
  tool.complete branch). Consumers then re-read the root + currently-EXPANDED
  folders only.
- The vault hook subscribes to that same tick, wired identically to the file
  browser (`use-vault-tree.ts` workspaceTick effect vs `use-project-tree.ts`).
  Nothing vault-specific was missed; directory listings are uncached in both.
- Three SHARED blind spots, any of which explains the miss (all apply equally
  to the stock file browser):
  1. Tool-name gate: a write via a tool whose name doesn't match the regex
     (and no inline_diff) never ticks. Stock `write_file`/`patch` DO match,
     but CT115's tool set is its own; the unusual chat rendering suggests a
     nonstandard write path.
  2. Subagent writes: a delegated subagent's inner tool.complete events don't
     land on this socket — only `subagent.*` summaries do — so no tick.
  3. Expanded-folders-only: a write into a never-expanded subfolder doesn't
     paint until that folder is expanded, by design, in both panes.
- **Decisive diagnostic for Steve:** flip Settings > Appearance > Tool Call
  Display to "Technical", redo the vault write, and read the tool NAME on the
  chat element; and note whether the file landed in the root or a subfolder,
  and whether that subfolder was expanded. Separately: asking Hermes to
  "use write_file to create /mnt/vaults/BotVault/test.md" should tick — if
  the pane still doesn't update on THAT, it's a vault-pane bug after all and
  gets fixed.
- Per the gate instruction, no fix applied: the gap is shared mechanism
  behavior, not a vault-pane defect.

**Resolution (Steve, 2026-07-05): logged as KNOWN LIMITATION, not a blocker.**
BotVault pane live-update is unconfirmed/possibly limited — same
tool-name-regex + expanded-folder-only mechanism as the stock file browser.
The discriminator test (Technical tool display + explicit write_file) is NOT
being chased now. Manual refresh (header refresh button) works as the
fallback. Revisit only if it becomes a real problem in practice.

**Phase 1 gate (increment 3), final:** PASS with the known limitation above.
Tree rendering, vault scoping, and click-to-composer-ref all confirmed;
live-update deliberately left unconfirmed.

---

### Increment 4 — Avatar asset pipeline

**Status:** Implemented 2026-07-05 by Claude Code (proposal approved same
day). Needs Steve's visual gate (below) — passable with or without real
assets.

**What:** the avatar pane's visuals are now a pure file drop. Each presence
state looks for `public/avatar/<state>.webp` (literal state names:
`idle listening thinking speaking toolUse waiting error`); any state whose
file is missing (or fails to load) falls back to the BrandMark-in-ring
placeholder. Ship `idle.webp` alone and add states later — zero, some, or all
assets all work. Ring tint, pulse, and the i18n state label stay overlaid on
whichever visual shows.

**Files:**
- `src/app/avatar/index.tsx` — `ASSET_BY_STATE` map (BASE_URL-relative, same
  resolution as BrandMark), `<img>` mount with per-state onError fallback
  tracking (component state, so a newly dropped file is picked up on the next
  pane toggle — no relaunch in dev). Animated WebP plays natively in the
  `<img>`; a state needing GIF/APNG/SVG is a one-line extension change.
- `public/avatar/README.md` (new) — the asset contract: exact filenames,
  square ~192x192 (renders 96x96 CSS px, HiDPI), circular-crop-safe
  (`object-cover`), partial sets fine. Folder ships with the build
  (vite public/ copy + electron-builder `public/**`).

**Assets landed same session:** Steve dropped the "Optimus Prime avatar
series" kit (built against the exact asset contract from the earlier spec
report — 7 state-named animated SVGs, 192x192, SMIL animation, camelCase
`toolUse`). Wired in: the 7 SVGs copied to `apps/desktop/public/avatar/`, the
`ASSET_BY_STATE` extensions flipped to `.svg`, README updated. The BrandMark
fallback machinery stays — any state whose file is removed/broken degrades
gracefully.

Note: the kit source files remain untouched OUTSIDE apps/desktop at repo root
(`assets/optimus1-7.png` ~2MB each, `assets/optimus_prime_avatar_series*`).
They're untracked; whether to commit, relocate, or delete them is Steve's
call — only the 7 small SVGs were brought into the app.

**Verification done (automated):** tsc clean, eslint clean, avatar tests 9/9.
SVGs sanity-checked (valid 192x192, animate tags present in all 7 states).

**Visual gate (Steve, interactive):** `npm run dev`, workspace mode ON:
1. Avatar pane shows the animated Optimus Prime idle SVG (not the BrandMark),
   circular, with ring + label as before.
2. Send a message: the artwork switches through Thinking (and Using tools if
   a tool fires) and back to Idle — each state has distinct art.
3. Play read-aloud: Speaking art shows while audio plays.
4. Temporarily rename one SVG (e.g. `waiting.svg`) → that state falls back to
   the BrandMark placeholder without breaking anything; restore after.

**Phase 1 gate (increment 4):**
- Additive changes land + automated checks pass: **PASS** (above).
- Visual gate (steps 1-4): **[ ] PENDING Steve**.

---

## Phase 4 — Voice (mic ownership RESOLVED; not started)

**BUILD CONSTRAINT — READ BEFORE ANY TRACK 1 / :9125 CODE (ADR-0014,
2026-07-06): the voice service MUST drive Hermes via /v1/runs
(POST /v1/runs + GET /v1/runs/{run_id}/events + POST /v1/runs/{run_id}/stop),
NOT /v1/responses. Only /v1/runs supports explicit cancellation, which
barge-in (ADR-0006) requires as its primary mechanism. Any earlier design
language naming /v1/responses as the driving surface (ADR-0002 wording,
older voice-protocol.md copies, prior scratch notes) is SUPERSEDED — do not
copy it by habit.**

**Mic-ownership question RESOLVED 2026-07-06 (Steve): the Electron renderer
owns the microphone directly — no separate MiniPC sidecar process.** Wake
detection, mic capture, and the :9125 voice WebSocket connection all live
inside this app. Recorded as ADR-0013 in docs/cockpit-reference/DECISIONS.md.
Rationale: keeps voice logic in one place alongside everything else built in
this app; no inter-process signaling needed. Tradeoff accepted: voice only
works while the app is running — not truly OS-level always-on.

Historical context (resolved): docs/cockpit-reference/voice-protocol.md specs
the :9125 WS as the contract between the "MiniPC wake/audio client" and the
CT115 voice service — wording that implied the audio client might be its own
process. Per this decision, that "wake/audio client" IS the renderer; the
fanned-out event-feed consumer model (event-protocol.md) is not the Phase 4
path, so copying event-protocol.md from CT115 is no longer a prerequisite.

Phase 4 is UNBLOCKED on mic ownership. Prerequisite status:
1. ~~The CT115 :9125 voice service does not exist~~ P1A BUILT 2026-07-06 —
   WS session skeleton, text-in/text-out, /v1/runs driving, verified
   barge-in cancellation. See "P1A build" below. P1B (TTS) / P1C (STT) not
   started. (Spec is LIVING; binary frame header still PROPOSED — expect
   wire changes until it firms up.)
2. ~~The P0.7 cancellation spike~~ RUN 2026-07-06, verdict **PARTIAL** — see
   spike results below and the ADR-0006 Consequences update in
   docs/cockpit-reference/DECISIONS.md.

### P0.7 cancellation spike — RESULTS (run 2026-07-06, empirical)

Method: POST /v1/responses (CT115 :8642, stream:true), prompt = run a shell
command that sleeps 15s then writes a marker file into BotVault. Client curl
SIGKILLed at t+5s (no clean close), file checked at t+65s and t+155s. One
control run (no kill) plus two kill runs. Stored response snapshots
(GET /v1/responses/{id}) and gateway logs used as server-side evidence.

Verdict: **PARTIAL** — cancellation works, with caveats:
- Hard client disconnect DOES cancel the run server-side. Both kill runs:
  gateway log shows "SSE client disconnected; interrupted agent task"
  (api_server.py: persist incomplete snapshot, agent.interrupt(), task
  cancel). Both stored responses ended status=incomplete.
- No orphaned tool execution. In both kill runs the agent had emitted a
  well-formed execute_code tool call for the file write; it was NEVER
  executed. The marker file never appeared (observed 5+ minutes).
- Caveat 1, lazy detection: the disconnect is only noticed when the server
  next WRITES an SSE event to the dead socket. Observed cancel latency
  7-12s with no deltas flowing; unbounded in principle during long silent
  stretches. The in-flight upstream LLM call ran to completion inside that
  window (it produced the full tool call — token cost + delay).
- Caveat 2, untested residual: a tool ALREADY EXECUTING at disconnect was
  not exercised (the spike's tool never started before cancellation). Treat
  in-progress tools as "may complete" per ADR-0007.
- Caveat 3, durable artifacts: the control run's agent creatively turned
  "run this command" into a script + recurring Hermes cron job, which kept
  writing into BotVault every 2 minutes until manually removed (job
  cancel-spike-runner b2cff5c20919, script ~/.hermes/scripts/cancel-spike.sh
  — both removed, vault cleaned). Cancellation can never retract this class
  of side effect. ADR-0007 stays load-bearing. Recorded as its own
  standing-automation risk (independent of voice/barge-in) in
  docs/cockpit-reference/safety-notes.md SN-001.

Design consequence for the :9125 voice service barge-in: do NOT drop the
TCP connection as the cancel primitive. Keep the stream open and cancel
explicitly. The explicit path was verified empirically the same day — see
the P0.7b follow-up spike below. Disconnect-as-cancel is a safety net, not
the mechanism.

### P0.7b run_stop follow-up spike — RESULTS (run 2026-07-06, empirical)

Question: does the advertised run_stop capability actually deliver prompt
explicit cancellation (the active path :9125 barge-in will depend on)?

Endpoint shape (step 1 finding, from /v1/capabilities + api_server.py):
run_stop is POST /v1/runs/{run_id}/stop — path param run_id only, no body.
It exists ONLY on the /v1/runs surface. /v1/responses has NO cancel
endpoint (no OpenAI-style POST /v1/responses/{id}/cancel), so the planned
"start via /v1/responses, stop via run_stop" shape is impossible; the test
used POST /v1/runs (body {"input": ...}, returns run_id immediately) +
GET /v1/runs/{run_id}/events (SSE) + stop at t+5s. Consequence: the :9125
voice service should drive Hermes through /v1/runs, not /v1/responses, to
get explicit cancellation.

Method: same slow-tool prompt class as P0.7 (sleep 15s then write marker to
run-stop-spike-scratch.md in BotVault), stop POSTed at t+5s with the SSE
event stream held open and per-event timestamps recorded. Two runs. Cron
jobs and ~/.hermes/scripts snapshotted before/after each run (SN-001 watch).

Verdict: **TRUE_CANCEL** — no ambiguity, both runs identical:
- Stream reflected cancellation in ~5 MILLISECONDS: stop POST 18:10:35.124
  -> run.cancelled event on the open SSE stream 18:10:35.129 (run 1);
  18:13:28.567 -> .572 (run 2). Run status flipped to "cancelled"
  immediately. Versus 7-12s lazy detection in the disconnect test.
- Generation actually stopped; nothing ran to completion and got discarded.
  Agent log both runs: "Turn ended: reason=interrupted_by_user,
  api_calls=0/90, tool_turns=0, response_len=0" — the in-flight first LLM
  call was aborted (zero completed API calls), no tool call was ever
  emitted. Contrast P0.7 disconnect runs, where the full function_call was
  generated and persisted before lazy detection latched.
- Scratch write prevented BEFORE tool-call emission, not just "eventually
  true": file absent at t+65s and t+155s, no function_call in any record.
- Internal unwind lag, for honesty: the agent turn fully ended 2.2s (run 1)
  and 6.4s (run 2) after the stop, matching the stop handler's bounded
  5s wait design (agent loop runs in an executor thread; agent.interrupt()
  breaks it, task.cancel() cannot preempt it). Client-visible cancellation
  is still the ~5ms number; the unwind is invisible on the stream and
  produced zero side effects.
- SN-001 watch: NO standing automation this time — cron list and scripts
  dir byte-identical before/after both runs (only pre-existing unrelated
  job tick fields moved). Note: the agent was stopped 5s in, before it
  could act at all, so this is absence of opportunity, not evidence the
  SN-001 risk is retired.

Barge-in design input: :9125 uses POST /v1/runs/{run_id}/stop as the
PRIMARY cancel; disconnect remains the backstop (P0.7).

### Phase 4 P1A build — voice session service :9125 (BUILT 2026-07-06, GATE PASSED Steve 2026-07-06; spec additions APPROVED)

**Status:** Implemented and smoke-tested by Claude Code over SSH. CT115-only;
zero app-repo/Electron changes. Stopped at P1A per plan — no TTS (P1B), no
STT/mic (P1C), no binary frames.

**What runs on CT115 (192.168.0.116):**
- `/opt/optimus-voice-service/` — own venv (aiohttp only) + `voice_service.py`
  + `smoke_test.py`. Source lives ON CT115 (repo rule 3); copy in session
  scratchpad.
- `optimus-voice-service.service` (systemd, enabled) — WS server on
  **0.0.0.0:9125**, path `/voice`, `?token=` auth at upgrade (constant-time),
  token at `/etc/optimus/voice-token` (600 root, NOT in repo). `/healthz` is
  the only unauthenticated path. permessage-deflate off per spec.
  System change: `python3.11-venv` apt package installed on CT115.
- Drives Hermes per ADR-0014: POST /v1/runs (with per-session
  conversation_history + X-Hermes-Session-Key `voice:<session_id>`), GET
  /v1/runs/{run_id}/events (SSE), POST /v1/runs/{run_id}/stop on interrupt.
  /v1/responses is not used anywhere.

**Protocol (P1A subset of voice-protocol.md, additions noted in the spec):**
session.start -> session.ready (epoch 0); text.input (P1A addition) starts a
turn; agent.text.delta / tool.started / tool.result stream back;
response.done ends the turn. voice.interrupt: bump epoch FIRST, POST stop,
truncate logged transcript to delivered text (P1A analogue of the playback
high-water mark), emit response.interrupted{at_epoch}; stale events from the
old epoch are discarded server-side and logged. Every server message carries
session_id, turn_id, run_id (in place of response_id — the real Hermes
handle), generation_epoch. One turn in flight per session; disconnect
teardown stops any live run (backstop per P0.7).

**Smoke test (ALL CHECKS PASSED, `smoke_test.py`, 2026-07-06 19:33-19:34 UTC):**
- Turn 1 (normal): 4 agent.text.delta frames streamed, text exact
  ("voice pipeline check ok"), response.done completed, IDs correct.
  Hermes first-delta latency ~13-16s in these runs (progress-filler
  design in P1B has to cover this).
- Turn 2 (barge-in mid-stream): voice.interrupt -> response.interrupted
  round trip 1ms client-side; upstream stop POST 200 in 0.8ms; Hermes
  run.cancelled arrived same millisecond, discarded as stale + logged
  "upstream cancel CONFIRMED"; upstream run status independently verified
  "cancelled" via GET /v1/runs/{id} with the API key (server-side proof,
  not client-side discard); zero stale deltas in a 10s post-interrupt
  watch; transcript truncated to the 303 delivered chars.
- Delta-granularity flag from ADR-0014 CLOSED: /v1/runs events stream
  forwards token-level message.delta — confirmed live, no gap.
- Auth: bad token -> 401 at upgrade; healthz reachable from the MiniPC.

**P1A gate for Steve (binary):**
1. `curl http://192.168.0.116:9125/healthz` from the MiniPC returns ok.
2. `ssh root@192.168.0.116 "cd /opt/optimus-voice-service && ./venv/bin/python smoke_test.py"`
   prints RESULT: ALL CHECKS PASSED (rerunnable; uses its own session).
3. Review the P1A spec additions in voice-protocol.md (text.input,
   session.ready, error, run_id-as-response_id) — approve or amend.

**GATE PASSED + spec additions approved: Steve, 2026-07-06.**

### Phase 4 P1B — TTS downlink (BUILT 2026-07-06; GATE PASSED Steve 2026-07-06, WAV verified by ear; spec additions APPROVED)

Built per the proposal below with Steve's answers applied: espeak-ng only
(Piper is a later increment, host undecided); fillers respect a per-session
mute flag (fillers_muted on session.start), phrasing Claude's call;
tts.playback.stop fires on BOTH barge-in and normal end with a reason field.

**Smoke test: ALL CHECKS PASSED (27 checks, 2 sessions, 4 turns,
2026-07-06 22:26 UTC).** Highlights:
- Normal turn: filler ack + one progress filler spoke during the ~15s
  Hermes thinking window; answer streamed as 20 OVX1 kind=2 frames, seq
  monotonic 0..19, epoch 0, closed by last-chunk flag;
  tts.playback.stop{end} preceded response.done. Answer audio (3.5s)
  reassembled to WAV — sent to Steve for the listening gate.
- Barge-in DURING generation (thinking window): response.interrupted in
  1ms, upstream run verified cancelled (stop POST 1.0ms), zero stale-epoch
  frames or deltas in a 10s watch.
- Barge-in MID-AUDIO after upstream completion: local stop path; upstream
  legitimately stays completed; zero stale frames; transcript truncated to
  the played_samples high-water mark (journal: "truncated to 400 heard
  chars, basis=played_samples").
- Muted session: no fillers, answer audio unaffected.

**Two real findings fixed during the build (both deployed):**
1. Transcript double-record: a barge-in landing after run.completed (TTS
   still draining) appended a truncated entry on top of the full final
   text. Now the completed turn's history entry is REPLACED with the heard
   portion (or dropped if nothing was heard).
2. Late barge-in hole (ADR-0006): audio is sent at synthesis speed, so a
   turn is service-side "done" while the client is still playing. A
   barge-in after response.done now still truncates the transcript when
   played_samples is reported. Corollary for the P1D/renderer client:
   playback pacing is CLIENT-side; the client must report played_samples
   on every interrupt.

**Deployment notes:** espeak-ng 1.51 apt-installed on CT115; service file
updated in place (/opt/optimus-voice-service/voice_service.py, healthz now
reports phase P1B); resample 22050->16000 via stdlib audioop (deprecated in
3.13 — revisit at the Piper increment).

**P1B gate for Steve (binary):**
1. Listen to the WAV sent in chat (or /tmp/p1b_answer.wav on CT115): two
   intelligible espeak sentences.
2. Rerun `ssh root@192.168.0.116 "cd /opt/optimus-voice-service && ./venv/bin/python smoke_test.py"`
   -> RESULT: ALL CHECKS PASSED.
3. Review the P1B spec additions in voice-protocol.md (tts.filler,
   fillers_muted, played_samples, stop-on-both-causes, kind=2 header
   exercised) — approve or amend.

Original proposal (kept for the record):

Scope: add the spoken-audio DOWNLINK to the P1A service. Text still enters
via text.input; audio goes out as binary frames. No mic, no STT (P1C). All
CT115-side; the MiniPC gets only a throwaway test-player script, no
Electron work.

1. **Engine: espeak-ng first (ADR-0009), behind a seam.** apt espeak-ng on
   CT115, wrapped in a TTSEngine interface (synthesize(text) -> PCM16 mono
   16kHz) so the Piper swap later is isolated. espeak-ng emits 22050 Hz;
   resample once at the engine edge to the spec's single internal rate
   (16 kHz, spec section 1).
2. **Binary frames per spec section 1.1** (first real use): 16-byte OVX1
   header, kind=2 tts-downlink, generation_epoch + seq, flags bit0
   last-chunk-of-response. Fixed-size batching ~200 ms per frame (6400
   bytes PCM16@16kHz), even-byte alignment guard (bridge notes section 4).
   Header stays PROPOSED until P1C exercises kind=1 uplink too.
3. **Sentence-boundary TTFA pipeline** (bridge notes section 7): accumulate
   agent.text.delta, cut on sentence punctuation, synthesize and stream
   each sentence as it completes. Never wait for response.done to start
   speaking.
4. **Barge-in extension (spec section 6 full path):** on voice.interrupt —
   kill any running synthesis, drop the queued PCM, emit
   tts.playback.stop + response.interrupted (P1A already does epoch bump +
   /v1/runs stop + stale-discard). Stale audio is client-droppable by
   header epoch.
5. **Playback high-water mark (ADR-0006 steps 3-4, real version):**
   voice.interrupt gains an optional played_samples field (client-reported).
   Server maps samples -> text via per-sentence sample offsets and truncates
   the logged transcript to what was actually PLAYED, replacing P1A's
   delivered-text approximation. Absent the field, fall back to
   delivered-sentences.
6. **Progress fillers (spec section 7):** included in P1B because fillers
   are spoken — and P1A measured 13-16 s to first Hermes delta, so dead-air
   cover is not optional. Immediate short ack on turn accept, rotating
   ~10 s fillers, escalation line, cancel on first real delta. Filler
   responses tagged with their own reason so they are interruptible and
   never mistaken for the answer.
7. **Smoke test + gate:** test client collects binary frames, validates
   header fields/seq/epoch ordering, writes a WAV; a barge-in run verifies
   tts.playback.stop + zero stale-epoch audio frames + upstream run
   cancelled; a filler run (slow prompt) verifies ack < 1 s and a filler
   before the first delta. Gate for Steve: play the WAV (or run the tiny
   MiniPC player script against a live turn) and hear the answer; trigger
   a barge-in and hear it stop.

Open questions to settle at P1B planning (not decided here):
- Piper timing: stay espeak-ng for the whole of P1B per ADR-0009, or pull
  Piper in behind the seam immediately if espeak-ng quality blocks the
  listening gate. Where does Piper run (CPU on CT115 vs the 3060 host)?
- Filler phrase set + whether fillers respect a per-session mute flag.
- Whether tts.playback.stop also fires on normal response.done (spec lists
  it for barge-in or end).

(All three answered by Steve 2026-07-06; see build record above.)

### Phase 4 P1.5 — Piper TTS swap (BUILT 2026-07-06; GATE PASSED Steve 2026-07-06 — A/B "dramatically more natural"; en_US-lessac-medium confirmed default, espeak-ng retained switchable)

Pure engine swap behind the P1B TTSEngine seam (ADR-0009's deferred
increment, header note added there). WS protocol, sentence chunking,
barge-in, fillers, and high-water-mark logic untouched — verified by
rerunning the full suite against Piper.

**Voice: en_US-lessac-medium** (Piper's reference voice, 63MB onnx,
22050Hz native -> resampled once to the 16k internal rate). Why: `low` is
noticeably robotic; `high` costs ~2-3x CPU for marginal gain on a 4-core
box shared with Hermes + whisper. Bench: model load 0.7s, RTF 0.02-0.04
(25-50x realtime) — sentence-level TTFA is synthesis-bound by ~100ms per
sentence, far better than espeak needed.

**Engine selection:** OPTIMUS_TTS_ENGINE env, default "piper";
espeak-ng kept installed and switchable ("espeak" + service restart), not
deleted. healthz now reports phase + tts_engine. Disk after voice
download: 25G total, ~6.4G free (resize confirmed before download).

**Smoke test: ALL CHECKS PASSED (30 checks, 5 utterances + gate turn,
2026-07-06 ~23:14 UTC).** Same P1C suite (mic loop, silence endpoint,
thinking-window barge-in with upstream cancel in 2ms, transcript gate)
plus two P1.5-specific runs:
- U4 A/B: Hermes replied with the exact P1B sentences; Piper audio
  captured (p15_ab.wav) for direct comparison against the espeak WAV.
- U5 mid-speech barge-in: interrupt while Piper answer audio was flowing
  -> tts.playback.stop{barge-in}, zero stale frames, transcript truncated
  to played_samples (journal: "630 heard chars, basis=played_samples").
  Note: the upstream stop for U5 returned 404 (run already completed and
  swept — expected for the mid-audio-after-completion case; logged,
  non-fatal by design).

**P1.5 gate for Steve (binary):**
1. A/B listen: p15_ab.wav (Piper) vs the P1B espeak WAV — same two
   sentences, should sound dramatically more natural.
2. p15_loop.wav: fresh full voice-to-voice loop answer via Piper.
3. Rerun the smoke test on CT115 -> RESULT: ALL CHECKS PASSED.

### Phase 4 P1C — STT / mic uplink (BUILT 2026-07-06; GATE PASSED Steve 2026-07-06 jointly with P1.5; spec additions APPROVED; section 1.1 header now FIRM)

Built per the proposal below (Steve green-lit option 2: local CPU int8 on
CT115; CT102 stays unknown-pending-recon, future STTEngine swap candidate).

**Pre-build bench (drove the go decision):** faster-whisper base.en, CPU
int8, 4 threads on CT115: model load 0.5s; whole-utterance decode 302ms for
1.4s audio, 334ms for 4.3s audio, both transcribed PERFECTLY from espeak
input. The ~1s partial cadence has 3x headroom; whole-utterance re-decode
chosen (sliding window unnecessary at these sizes).

**Smoke test: ALL CHECKS PASSED (24 checks, 3 utterances, 2026-07-06
~22:52 UTC).** The CT115-side voice loop is CLOSED:
- U1 (commit path, full loop): synthesized "hello can you hear me" streamed
  as kind=1 frames at realtime pace -> stt.final 'hello can you hear me?'
  (exact) -> Hermes -> spoken reply "Loud and clear, Captain. Optimus
  online. What do you need?" (4.3s WAV sent to Steve for the gate).
- U2 (silence path + barge-in): 3 stt.partial at ~1s cadence while
  streaming; silence endpoint fired (no commit); transcript exact (whisper
  wrote numerals: "count from 1 to 100"); barge-in during the thinking
  window -> response.interrupted in 1ms, upstream run verified cancelled,
  zero stale frames/deltas.
- U3 (transcript gate): "uh" (whisper heard "of", 2 chars) -> stt.final
  emitted, response.done{status:"ignored"}, run_id null - no Hermes run
  burned.

**Spec updates (voice-protocol.md, pending gate approval):** stt.final
gains endpoint_source (commit|silence|max-length); response.done gains
status "ignored"; P1C rules noted (mic frames during in-flight turn are
discarded - barge-in signal stays client-side in P1C; interrupt discards a
half-captured utterance; mode-dependent silence windows 1.2/1.5/2.0s).
Section 1.1 header now exercised for BOTH kinds - flips to FIRM on gate
pass.

**Deployment notes:** faster-whisper 1.2.1 + numpy into the service venv;
base.en int8 model cached on first load; healthz reports phase P1C; startup
fail-fast now warms BOTH engines (TTS speaks "ready", STT transcribes it
back - the loop self-checks at boot). CT115 disk now 88% full (2.3G free
BEFORE model cache) - flag for capacity planning before Piper voices land.
audioop deprecation (3.13) now used in both resample paths - unchanged
revisit-at-Piper note.

**P1C gate for Steve (binary):**
1. Listen to the loop WAV sent in chat: it is Hermes's spoken answer to a
   spoken (synthesized) question that went in as mic frames.
2. Read the transcripts above vs the spoken inputs (both exact; whisper
   normalizes numbers to digits).
3. Rerun `ssh root@192.168.0.116 "cd /opt/optimus-voice-service && ./venv/bin/python smoke_test.py"`
   -> RESULT: ALL CHECKS PASSED.
4. Approve the P1C spec additions; on approval, section 1.1 header flips
   PROPOSED -> FIRM.

Original proposal (kept for the record):

Scope: the audio UPLINK. The :9125 service accepts mic PCM as binary
frames, transcribes with streaming faster-whisper (ADR-0002), and feeds
stt.final into the SAME internal turn path text.input uses today. This
completes the CT115-side voice loop: audio in -> transcript -> Hermes ->
TTS out. Still CT115-only: no real microphone anywhere in P1C — the test
harness synthesizes utterances (espeak-ng) and streams them as mic frames.
Real mic capture + wake/VAD is the renderer client (ADR-0013), a later
increment; D3 (wake word vs open mic) stays undecided and is NOT forced by
P1C.

1. **Mic uplink frames:** accept binary kind=1 per spec section 1.1 (PCM16
   mono 16k; header epoch + per-utterance seq). Reject was P1A/P1B
   behavior; now kind=1 is routed to the STT buffer, kind=2 uplink is a
   protocol error. Seq gaps logged (spec section 9). This exercises the
   header's second half — on P1C gate pass the section 1.1 layout is
   declared FIRM.
2. **STTEngine seam** mirroring TTSEngine: faster-whisper behind it.
   Start CPU int8 with a small model ("base" or "small"); measure; the
   model/device question escalates only if the latency gate fails. (Piper
   precedent: engine choice is swappable behind the seam, host questions
   deferred.)
3. **Streaming partials:** inference ticks over the accumulating utterance
   buffer (~1s cadence) emit stt.partial; throttled, marked with turn_id +
   epoch like everything else.
4. **Endpointing:** the explicit path first — audio.input.commit (spec
   section 3) closes the utterance, triggers final inference, emits
   stt.final, and starts the turn. Server-side silence endpointing (energy
   or webrtcvad over the tail of the buffer) as fallback with a
   mode-dependent silence window (spec section 8). Commit-driven is
   gate-required; server endpointing is built but gated to
   listening_for_turn/conversation modes.
5. **Turn wiring:** stt.final text enters the existing turn machinery
   unchanged (fillers, deltas, TTS, barge-in, high-water mark all already
   work). voice.interrupt during SPEAKING plus new mic audio = the spec
   section 6 sequence, unchanged.
6. **Transcript gate** (bridge notes section 7): drop empty/filler-only
   transcripts ("uh", <2 chars) with a logged reason instead of burning a
   full Hermes turn. Cheap, protects against endpointing noise.
7. **Smoke test:** synthesize known utterances with espeak-ng, stream as
   kind=1 frames at realtime pace; verify stt.partial emitted while
   streaming, stt.final matches expected text (normalized), the turn
   round-trips to spoken TTS; commit path and silence-endpoint path both
   produce exactly one turn; a barge-in mid-answer still cancels upstream;
   an "uh"-only utterance produces no Hermes run. WAV of a full
   voice-to-voice loop captured for the gate.
8. **Gate for Steve (binary):** smoke test ALL CHECKS PASSED; read the
   stt.final transcripts in the test output and confirm they match the
   spoken inputs; listen to the loop WAV; spec section 1.1 flips to FIRM.

Open questions to settle at P1C planning (not decided here):
- faster-whisper model + device: does CT115 have GPU access at all (check
  lspci at planning), and is CPU int8 "base"/"small" fast enough for ~1s
  partial cadence on this box? Escalation path if not: bigger CPU budget,
  GPU host, or slower cadence.
- Partial cadence (1s proposed) and how much rolling context each
  inference tick re-decodes (whole utterance vs sliding window) — accuracy
  vs CPU tradeoff, measure both.
- Silence window defaults per session mode (spec section 8 gives the
  shape; numbers TBD).
- Disk/net: faster-whisper pulls ctranslate2 + model weights (hundreds of
  MB) into the service venv on first run — confirm CT115 disk headroom.

(P1C built and gate passed 2026-07-06; see build record above.)

### Phase 4 P1D-1 — push-to-talk renderer voice client (BUILT 2026-07-06; GATE PASSED Steve 2026-07-06 — live mic/transcript/Piper/barge-in all verified at the machine; stop-signal semantics APPROVED into voice-protocol.md)

Built per the proposal below with Steve's answers applied: D3 deferred to
P1D-2; token = settings field pasted once, persisted locally, never
committed; AEC punted to P1D-2 (PTT sidesteps open-mic-over-speakers);
voice UI lives in the avatar pane.

**First Phase 4 code in the repo.** All additive (fork hygiene):
- NEW `apps/desktop/src/app/voice/` — protocol.ts (OVX1 codec + PCM16
  conversion, unit-tested), mic.ts (getUserMedia echoCancellation:true ->
  AudioWorklet-via-Blob at 16k -> 100ms kind=1 frames while PTT held),
  playback.ts (Web Audio queue with realtime pacing; per-chunk
  answer/filler tagging so played_samples counts ANSWER audio only —
  fillers announced by tts.filler, delimited by last-chunk flags),
  client.ts (WS + session lifecycle, epoch discipline client-side
  backstop, PTT flow, barge-in = voice.interrupt + played_samples +
  immediate local flush), store.ts (persistentAtom settings: server URL
  default ws://192.168.0.116:9125/voice + token; live-state atoms),
  index.tsx (VoiceControls UI), protocol.test.ts (5 tests).
- EDITED `src/app/avatar/index.tsx` (+2 lines): renders VoiceControls.
  The client drives setAvatarListening (capturing) and
  setVoicePlaybackState source 'voice-conversation' (speaking) — the
  avatar's listening/speaking states light up live. Known P1D-1 gap: the
  avatar shows idle (not thinking) during voice-turn Hermes latency,
  because $avatarState derives thinking from the app's own chat session,
  not voice runs; the fillers cover the dead air audibly. Revisit in P1D-2.
- EDITED i18n x5 (en/ja/zh/zh-hant/types): voicePanel keys.
- tts.playback.stop client semantics: "barge-in" flushes NOW; "end" only
  marks no-more-frames and lets the buffer drain — flushing on "end"
  would amputate the un-played tail under the service's burst sending.
  APPROVED as spec by Steve 2026-07-06; written into voice-protocol.md
  (section 4 table row + P1D-1 note).

**Machine verification (this session):** typecheck clean; eslint clean
(one pre-existing warning elsewhere); protocol unit tests 5/5; full
renderer build passes. NOT machine-verifiable: real mic, speakers,
permission prompt, PTT feel — that is the gate.

**P1D-1 gate (Steve, at the MiniPC, binary):**
1. `npm run dev` (workspace mode ON), avatar pane -> paste voice token
   (CT115 /etc/optimus/voice-token) -> Connect voice.
2. Hold-to-talk, speak, release: correct transcript appears under the
   avatar, Piper answer plays through speakers at natural pace, avatar
   shows listening (hold) then speaking (playback).
3. Press mid-answer: playback dies instantly (no ghost tail), service
   journal on CT115 shows "transcript truncated ... basis=played_samples".
4. Speak again after barge-in: next turn works (epoch discipline held).

### Phase 4 P1D — renderer voice client (PROPOSAL 2026-07-06; P1D-1 built above, P1D-2 not started)

Scope: the FIRST Phase 4 code inside this repo. Per ADR-0013 the Electron
renderer owns the microphone: mic capture, wake/VAD, playback, and the
:9125 WS connection all live in apps/desktop. Everything CT115-side is
done (P1A-P1.5); P1D is the client that makes it usable by a human.
Fork hygiene applies again: new `src/app/voice/` directory, additive only,
mounted on the workspaceMode seam (children render only in workspace
mode), second WS alongside the existing tui_gateway socket (per the
cockpit-arch-seams note — they coexist, neither replaces the other).

Split into two gated sub-increments so D3 does not block the client build:

**P1D-1 — push-to-talk client (defers D3 legitimately):**
1. WS client + protocol codec: JSON messages + OVX1 binary frames (FIRM
   header), session.start/ready, four-ID tracking, epoch discipline
   (drop any delta/audio frame whose epoch < current).
2. Mic capture: getUserMedia (echoCancellation: true — ADR-0008 first
   line of echo defense) -> AudioWorklet downsample 48k->16k PCM16 ->
   100ms kind=1 frames while the PTT key is held; audio.input.commit on
   release. Mic permission via Electron session permission handler.
3. Playback: Web Audio queue with REALTIME PACING (the service sends at
   synthesis speed — buffering is explicitly the client's job, P1B
   finding) and a played-samples high-water counter driven by the audio
   clock. Every voice.interrupt sent MUST carry played_samples — this is
   what keeps the Hermes transcript honest (ADR-0006 steps 3-4).
4. Barge-in: PTT press while state=speaking sends voice.interrupt
   (+played_samples), flushes the local playback buffer on
   tts.playback.stop, discards stale-epoch frames.
5. State machine + avatar seam: listening/thinking/speaking states drive
   `$avatarListening` (src/store/avatar.ts) and the existing avatar
   speaking flag — Phase 5's avatar gets its missing "listening" input
   for free.
6. Voice token: the renderer needs the CT115 /etc/optimus/voice-token
   value. Proposal: a settings field (persisted like other cockpit
   settings, NEVER committed); paste once. Decide at planning if a
   different mechanism is preferred.
P1D-1 gate (binary, Steve at the real machine): hold key, speak, correct
transcript appears, Piper answer plays through speakers at natural pace;
press again mid-answer — playback stops instantly, no ghost audio tail,
service journal shows played_samples truncation; mic stays live during
TTS (ADR-0008) without the answer re-triggering capture.

**P1D-2 — always-on (D3 decided here, not before):**
Wake-word vs open-mic VAD vs keep-PTT. Prior art: Satellite1 "OK Nabu";
Cockpit design assumed open mic + VAD + barge-in. P1D-1 gives real-world
data (echo behavior, ambient noise on the MiniPC) to decide with. Add the
chosen gate in front of the same capture path; client-side VAD/energy (or
wake engine) decides utterance start/stop; server silence endpoint stays
as backstop.
P1D-2 gate = the Phase 4 gate from CLAUDE.md, verbatim: mic hot 10+
minutes with ambient noise, ZERO false activations under the chosen D3
policy; mid-response barge-in truncates audio with no ghost playback and
no stale tool side effects.

Open questions to settle at P1D planning (not decided here):
- D3 itself — recommendation: build P1D-1 (PTT) first, decide D3 with
  real echo/noise data before P1D-2. PTT alone is already dramatically
  more usable than nothing.
- Voice-token distribution to the renderer (settings paste vs config file
  vs future keychain) — never committed either way.
- AEC sufficiency: is Chromium's built-in echoCancellation enough with
  speakers + open mic, or does the Cockpit loopback-reference AEC design
  need porting (ADR-0008 allows raised-VAD-first)? Measure in P1D-1.
- Where the voice UI lives: inside the avatar pane, its own small pane,
  or a composer-adjacent control. Cheap to move later; pick at planning.

Downstream notes: `$avatarListening` (src/store/avatar.ts) is the seam the
listening state plugs into; ADR-0008 (mic stays live during TTS, pausing
capture banned) now binds the renderer as the audio owner.

---

## Phase 6 — Browser viewport (step 0 stack UP; see+click gate pending)

**Step 0 history:** first attempt 2026-07-05 was blocked (CT119 off the
network — no ARP, SSH timeout; sibling LXCs fine). Steve brought CT119 up and
authorized the MiniPC's SSH key (`claude-code@SW-MINIVAC` ed25519,
root@192.168.0.119); key auth verified 2026-07-06.

**Step 0 executed 2026-07-06 by Claude Code over SSH** (script:
`ct119-step0.sh`, run as root on CT119 — Debian 12, hostname
search-services, 2c/2GB confirmed):
- `apt install xvfb x11vnc websockify novnc firefox-esr x11-utils`
- Four systemd units, enabled + started, all `active`:
  - `optimus-xvfb` — Xvfb :99, 1024x768x24
  - `optimus-firefox` — firefox-esr on DISPLAY=:99, persistent profile
    `/var/lib/optimus/browser-profile` (HOME=/root set for the unit)
  - `optimus-x11vnc` — `-rfbauth /etc/optimus/vncpass -localhost -rfbport
    5900 -forever -shared`
  - `optimus-novnc` — `websockify --web=/usr/share/novnc 9127 localhost:5900`
- **Auth requirement honored, not skipped:** password generated on CT119 via
  `openssl rand`, stored with `x11vnc -storepasswd` at `/etc/optimus/vncpass`
  (600 root); recovery copy `/etc/optimus/vncpass.plain` (600 root). Verified
  the LIVE x11vnc process carries `-rfbauth` (read from /proc cmdline). The
  password itself is deliberately NOT in this file. To rotate:
  `x11vnc -storepasswd '<new>' /etc/optimus/vncpass && echo "VNC_PASSWORD=<new>"
  > /etc/optimus/vncpass.plain && systemctl restart optimus-x11vnc`.
- **Exposure shape as designed:** raw RFB binds 127.0.0.1:5900 only; the LAN
  sees exactly one thing, websockify on 0.0.0.0:9127 (verified via `ss`).
- Verified from the MiniPC: `http://192.168.0.119:9127/vnc.html` returns
  HTTP 200; a Firefox window ("Navigator") is live on :99 (xwininfo).

**Step 0 gate (Steve, interactive):** open
`http://192.168.0.119:9127/vnc.html` in a plain browser on the MiniPC,
Connect, enter the VNC password (in chat / `/etc/optimus/vncpass.plain` on
CT119), confirm you SEE Firefox and can CLICK/TYPE in it (e.g. focus the
address bar, load a page).
- Stack up + password gate verified + page serves: **PASS** (above).
- Human see+click through noVNC: **PASS** (Steve confirmed directly,
  2026-07-06). **Step 0 DONE.**

### Phase 6 step 1 — cockpit noVNC pane

**Status:** Implemented 2026-07-06 by Claude Code. Needs Steve's visual gate
(below). Human viewing/control plane ONLY — :9126 verb API and Hermes tool
wiring deliberately absent (later steps).

**What:** `<Pane id="browser">` on the workspaceMode seam, same additive
pattern as avatar/BotVault: registered in layout.ts, seeded open in the
workspace arrangement (seed-merge puts it in the existing workspace),
palette toggle ("Toggle browser pane"), invisible in stock mode. The pane
embeds a noVNC client (`@novnc/novnc` 1.7.0, new dependency) dialing
`ws://192.168.0.119:9127/websockify` directly. VNC password is entered
in-pane per session — component state only, never persisted, never in the
repo. noVNC's scaleViewport letterboxes the fixed 1024x768 framebuffer into
the pane (aspect preserved by the client itself). Pane children mount only
in workspace mode, so a hidden pane can never hold a live VNC socket in
stock mode; unmount/teardown disconnects.

**Files:** `src/app/browser/index.tsx` (new — pane, connect form, RFB
lifecycle, auth-failure vs connection-lost states), `src/app/browser/
novnc.d.ts` (new — minimal typings; the package ships none), layout.ts
(BROWSER_PANE_ID + toggle), workspace-mode.ts (seed), desktop-controller
(pane wiring, between botvault and avatar both orientations, 36rem default
/ 20-72rem resizable), command palette, i18n x4 + types,
apps/desktop/package.json + ROOT package-lock.json (dependency add via
`npm install @novnc/novnc --workspace apps/desktop` — the lockfile edit is
intentional and required; the root lockfile is the workspace mechanism).

**Verification (automated):** tsc clean; eslint clean; `vite build` passes
(novnc ESM bundles; chunk-size warning pre-existing); store tests 14/14.

**Visual gate (Steve, interactive):** `npm run dev`, workspace mode ON:
1. Browser pane appears (rail, next to BotVault). Password field + Connect.
2. Wrong password → "Authentication failed.", form returns.
3. Correct password → CT119's Firefox appears, letterboxed 4:3; click/type
   works (focus address bar, load a page) — same as the step-0 plain-browser
   test but inside the cockpit.
4. Disconnect button (header) returns to the form; toggling workspace mode
   OFF kills the connection (no socket in stock mode).
5. Stock mode: no browser pane anywhere.

**Phase 6 gate (step 1):**
- Additive changes land + automated checks pass: **PASS** (above).
- Visual gate (steps 1-5): **PASS** (Steve confirmed, gate run prior to
  step 2). **Step 1 DONE.**

### Phase 6 step 2 — browser-bridge verb API on CT119 (BUILT + VERIFIED)

**Status:** DONE 2026-07-06 by Claude Code over SSH. All app-repo scope: none
(this is CT119 infrastructure, like the STT/TTS services — no Electron/fork
code). Verified working end-to-end from CT119.

**Architecture correction that had to be made (flag):** the plan said "attach
Playwright to the existing Firefox on :99." That is NOT possible — Playwright
cannot attach to a stock firefox-esr (its Firefox support needs Playwright's
own build; connect_over_cdp is Chromium-only). The correct shared-browser
model (camofox §1) is that Playwright LAUNCHES the browser headed on :99 and
x11vnc exports that display, so human (noVNC) and agent (Playwright) drive the
same visible browser + same tab. Consequence: **the standalone
optimus-firefox.service from step 0 is RETIRED** — the bridge is now the sole
browser owner on :99. (Step 1's cockpit pane is unaffected: it still views
:99 via noVNC; it just now sees Playwright's Firefox instead of the standalone
one.)

**What runs on CT119 (192.168.0.119):**
- `/opt/optimus-browser-bridge/` — Python venv (playwright, mcp SDK, starlette,
  uvicorn) + `bridge.py` + Playwright's Firefox. Source lives ON CT119, NOT in
  this repo (CLAUDE.md rule 3 forbids repo paths outside apps/desktop; a copy
  is in this session's scratchpad). Steve may want it in a CT119-side repo.
- `optimus-browser-bridge.service` (systemd) — launches the Playwright browser
  (launch_persistent_context on the same /var/lib/optimus/browser-profile,
  headed, :99, 1024x768) and serves an MCP StreamableHTTP server on
  **0.0.0.0:9126**. Requires optimus-xvfb.
- Auth: bearer token at `/etc/optimus/bridge-token` (600 root), required on
  every :9126 request (build-time requirement honored; /healthz is the only
  unauthenticated path). Token value is NOT in the repo.
- Service map now: optimus-xvfb, optimus-browser-bridge (owns Firefox),
  optimus-x11vnc, optimus-novnc — all active; optimus-firefox removed.

**Verb set (deliberately minimal for step 2/3; NO evaluate, NO gate yet):**
`navigate(url)`, `page_info()`, `observe(max_chars)` (aria-snapshot
role/name tree — ref-based targeting per camofox §3), `click(name)`,
`type_text(name, text, submit?)`, `press(key)`. Single-tab discipline: popups
folded back into the one visible page. `evaluate`, the owner-approval gate,
success-shaped deny stubs, and login-context redaction are all Phase 6 step 4
(camofox §4 gaps) — intentionally absent here.

**Verified on CT119 (real MCP client, the same SDK Hermes uses):** tool list
returns all 6; `navigate` → example.com (url+title back); `observe` → aria
tree with link refs+URLs; `click("Learn more")` → page moved to
iana.org (interaction verbs mutate real state); auth gate returns 401 without
the token; /healthz 200. The human sees every one of these in the noVNC pane
(same browser) — confirms the shared-browser model.

### Phase 6 step 3 — Hermes tool registration (CT115-side; NOT executed here)

**Cannot be done from this session (rule 5):** the tool is registered in
Hermes's config, which lives on CT115 — no SSH access from the MiniPC, and
it's outside this repo. Handed to Steve, ready to paste.

**Mechanism (verified from vendor `tools/mcp_tool.py:33-56`):** Hermes natively
consumes MCP servers over StreamableHTTP via the `mcp_servers` config `url`
key with optional `headers`. So registration is pure config — no Python, no
guessing at internals. Add to CT115's Hermes config (config.yaml `mcp_servers`,
OR via the cockpit's own Settings → MCP editor, which writes to the connected
CT115 backend):

```yaml
mcp_servers:
  optimus-browser:
    url: "http://192.168.0.119:9126/mcp"
    headers:
      Authorization: "Bearer <CT119:/etc/optimus/bridge-token>"
```

Then verify (Steve): ask the agent to use the browser (e.g. "open example.com
in the browser and tell me the page title") and watch the noVNC pane move.
The tool names the agent sees are navigate / page_info / observe / click /
type_text / press.

**INTERIM RISK — flag, decide before relying on it:** step 3 gives the agent
UNGATED control of the shared browser (any site the browser is logged into),
because the owner-approval gate is step 4. Between registering the tool and
building step 4, do not leave sensitive logged-in sessions in that browser
profile, or hold off registering until step 4 lands. This is the sequencing
the plan chose; surfacing it so it's a decision, not an accident.

**Phase 6 gate (step 2):** bridge built + verb round-trip + auth gate verified
on CT119: **PASS**.

### Phase 6 step 4 — safety layer (BUILT + VERIFIED on CT119)

**Status:** DONE 2026-07-06 by Claude Code over SSH, in
`/opt/optimus-browser-bridge/bridge.py`. CT119-only; zero app-repo/Electron
changes. **Step 4 was built BEFORE step 3's MCP config was pasted** — so the
bridge never registered with Hermes while ungated.

**1. Owner-approval gate, by CATEGORY (not a name list).** Verbs are split
`READ_VERBS = {page_info, observe}` / `WRITE_VERBS = {navigate, click,
type_text, press}`. At startup the service enumerates its own registered MCP
tools and **refuses to start (SystemExit) if any tool is in neither set** —
so a new state-mutating verb added later cannot ship ungated by accident
(verified: injecting a `rogue_delete_everything` tool is caught). Every write
verb blocks on owner approval; **default DENY on a 30s timeout** (env
`OPTIMUS_APPROVAL_TIMEOUT_S`). Read verbs never gate.

**2. Success-shaped deny stub.** A denied/timed-out write returns a well-formed
envelope for that verb (navigate → `{url,title,denied:true,reason}`; others →
`{ok:true,url,denied:true,reason}`) — no exception, so the agent doesn't
retry-thrash. `denied:true` is the honest flag for a caller that inspects it.

**3. Login-context redaction (inverts Joshu's heuristic).** `observe()` detects
an auth page by URL pattern (login/signin/oauth/sso/…) OR a `input[type=
password]` in the DOM. On detection it returns DRASTICALLY reduced context —
url + title + a fixed notice, **no aria snapshot, no form structure, never
field values**. (Joshu escalated to full DOM on 'log in'; we do the opposite.)

**4. Fresh-snapshot enforcement.** Element-targeted writes (click, type_text)
refuse to act unless an `observe()` was taken on the CURRENT url; any
URL-changing write invalidates the snapshot. A stale attempt returns a
well-formed `{ok:true,url,stale:true,note}` telling the agent to observe first
— state cannot go stale silently. (navigate/press don't target elements, so no
precheck; they invalidate the snapshot after.)

**Verified on CT119 (curl + real MCP client, concurrent approval):**
- observe ungated works; login_context=false on a normal page. ✓
- navigate BLOCKS pending approval; approving it executes (→ example.com). ✓
- navigate denied → `denied:true`, success-shaped (has url+title), page
  unchanged, no error. ✓ (timeout uses the same deny-stub path.)
- click without a fresh observe → `stale:true`, well-formed. ✓
- login page (password input) → `login_context:true`, snapshot withheld,
  the word "password" never present in the returned context. ✓
- fail-closed category check catches an uncategorized verb. ✓

**HOW STEVE APPROVES (the part to understand before relying on it):**
The mechanism today is curl-based (a cockpit UI is a later step, not built
this session). When the agent calls a write verb, the service **logs a line to
journald** with an approval id and the exact commands:
```
journalctl -u optimus-browser-bridge -f        # watch this (on CT119)
# on a write call you'll see:
[APPROVAL NEEDED] id=ab12cd verb=navigate args={'url': 'https://…'}  approve: curl … /approvals/ab12cd/approve …  |  deny: …  |  auto-DENY in 30s
```
Then, within 30s, from CT119 (token in /etc/optimus/bridge-token):
```
TOK=$(cat /etc/optimus/bridge-token)
curl -s http://127.0.0.1:9126/approvals -H "Authorization: Bearer $TOK"        # list pending (id, verb, args, age)
curl -s -X POST http://127.0.0.1:9126/approvals/ab12cd/approve -H "Authorization: Bearer $TOK"
curl -s -X POST http://127.0.0.1:9126/approvals/ab12cd/deny    -H "Authorization: Bearer $TOK"
```
Reality check for Steve: **every single agent browser write pauses up to 30s
waiting for you to run an approve curl, and silently DENIES if you don't.**
That is safe but heavy — fine for first real use / trust-building, and the
signal for when a friendlier approver (cockpit button, phone push) becomes
worth building. The approval endpoints require the bearer token; they're
reachable LAN-wide on :9126 like the rest of the API.

### Phase 6 step 3 — Hermes tool registration (CONFIG WRITTEN 2026-07-06)

MiniPC now HAS SSH to CT115 (root@192.168.0.116, hostname "hermes"; Steve
authorized). Claude Code edited `/root/.hermes/config.yaml` on CT115: added an
`optimus-browser` entry under `mcp_servers` (url http://192.168.0.119:9126/mcp
+ Authorization: Bearer <token>), alphabetical, matching herobot-vnext's
style. Safeguards: original + result validated via yaml.safe_load; asserted
gbrain / herobot-vnext / unifi-network byte-identical (not touched); timestamped
backup `config.yaml.bak-optimus-browser-20260706T123029Z`. Token is inline
(Steve's chosen format); it can be moved to `~/.hermes/.env` as
`${OPTIMUS_BRIDGE_TOKEN}` later for hygiene.

**Reload (from the code):** MCP discovery re-reads config fresh from disk
(`tools/mcp_tool.py` load_config), so `/reload-mcp` picks up the new server —
or restart the gateway. A NEW chat/turn sees the tools; an open session keeps
its frozen snapshot until reload.

**Remaining for Steve:** reload-mcp (or gateway restart) → start a fresh chat →
ask the agent to use the browser. First write action hangs up to 30s pending
your curl approval (step-4 gate). Verbs the agent sees: navigate, page_info,
observe, click, type_text, press.

**Phase 6 status:** steps 0,1,2,4 DONE + verified; step 3 config written,
pending Steve's reload + first agent-drives-browser test. Then Phase 6's core
loop (agent + human share one gated, streamed browser) is complete.

Untouched, per scope: CT117, all Electron/app-repo code (this was a one-line
CT115 config add + the CT119 services).

**ADR-0012 accepted 2026-07-05 (Steve): VNC/noVNC**, matching Joshu's
approach. Rationale: the free, structurally-guaranteed human-input plane
(keystrokes go RFB to Xvfb to Firefox directly, never becoming text or LLM
context) fits this project's pattern of architectural rather than promised
safety (auto-update kill-switch; ADR-0007). Traded off: heavier infra + fixed
resolution (1024x768) vs CDP's lighter weight and flexible resolution with no
free takeover mechanism. Recorded in docs/cockpit-reference/DECISIONS.md.

**Scoping report delivered in-session 2026-07-05** (Camofox not required for
a LAN single-user build; CT115-side service sketch; Electron pane = noVNC
client + agent verbs stay on CT115; proof-of-life sequencing). Key points:
- Camofox's differentiators (stealth fingerprinting, residential proxy, GHCR
  release plumbing) are cloud/anti-bot concerns; standard pieces suffice:
  headed browser + Xvfb + x11vnc + websockify + a small Playwright verb
  bridge WE write (the piece no off-the-shelf browser+VNC image provides).
  Camofox stays the fallback if a specific site fights automation.
- **Host: CT119 ("search-services", 192.168.0.119), NOT CT115** (Steve,
  2026-07-05). CT119 is a separate LXC on Urithiru already running SearXNG
  (negligible load), IP is a static reservation (confirmed fixed, not DHCP),
  bumped to 2 cores / 2GB RAM for headroom. Service sketch:

  ```
  optimus-browser-bridge (CT119, 192.168.0.119)
    Xvfb :99, 1024x768x24
    Headed browser on DISPLAY=:99 (persistent profile dir)
    x11vnc
    websockify (noVNC), proposed :9127
    browser-bridge API (Playwright verb service), proposed :9126
  ```

  Deployment: systemd units, no Docker — so the LXC nesting concern flagged
  for CT115 does not arise at all (nesting only mattered for Docker-in-LXC;
  Xvfb/x11vnc/a headed browser are pure userspace, no /dev/dri or kernel
  modules, fine in an LXC as plain services). Ports :9126/:9127 to be
  confirmed free on CT119. Persistent browser profile dir is mandatory (fix
  Joshu's cookie-loss gap).
- Cross-container reachability is a non-issue: Hermes's browser tool (on
  CT115) calls out to 192.168.0.119:9126 the same way it already calls MCPO
  on CT117 — plain LAN egress to another service host, different IP, same
  kind. The Electron pane (MiniPC) dials ws://192.168.0.119:9127/websockify
  directly, exactly as it would have for CT115.
- **LAN exposure — build-time REQUIREMENT, not optional hardening (Steve,
  2026-07-05):** the bridge binds LAN-reachable as scoped, but the
  framebuffer and the verb API must not ship unauthenticated, even on the
  trusted home LAN. Minimum second layer: a VNC password on the RFB/noVNC
  path (x11vnc password auth, carried through websockify), and the :9126
  verb API likewise requires auth (a static shared token is sufficient).
  This applies from proof-of-life step 0 onward — the unauthenticated stack
  never goes up, not even "temporarily".
- Electron pane: noVNC client canvas (@novnc/novnc) on the workspaceMode
  seam; human input rides RFB (bypasses agent, by design). Agent actions do
  NOT flow through the pane: Hermes on CT115 calls the bridge's HTTP verbs
  directly (one action layer, many wires, per arozos-lgui-notes; human RFB is
  deliberately NOT one of those wires).
- Proof-of-life sequence: (0) CT115 stack up, viewed from a plain browser on
  the MiniPC; (1) cockpit pane embeds noVNC client, see+click from the pane;
  (2) bridge v0 (health+navigate, curl-tested); (3) Hermes tool wiring
  (adopt-existing-tab, observe/click/type); (4) safety layer (owner gate incl.
  evaluate/submit, success-shaped deny stubs, light-context-on-login).

**Phase 4 cross-check:** no conflict or duplication. Phase 4's open question
is about AUDIO ownership (:9125 voice); Phase 6's human-input plane is RFB
into the browser stack — different service, different ports, different
question. One shared prerequisite to note: event-protocol.md (still on CT115)
defines the browser.* event family too, so copying it serves both phases.

---

## Next actions, in order

1. **Steve:** run the increment 4 visual gate (steps 1-4 above) — the Optimus
   Prime series is already wired in. Also decide what to do with the raw kit
   files at repo root (`assets/optimus*.png`, the zip + extracted dir): they
   are untracked and outside apps/desktop.
2. **Later:** voice WS client once CT115 :9125 is live (the spec is a LIVING
   SPEC with the binary header still PROPOSED — building early risks rework,
   and the raw :9125 socket is specced as the MiniPC *wake/audio client's*
   contract, which may not be the Electron renderer itself; also copy
   docs/architecture/event-protocol.md from CT115 into docs/cockpit-reference/
   before that work); browser viewport pane (blocked on ADR-0012 VNC-vs-CDP);
   avatar headshot asset swap (needs an asset from Steve).

Phases 0, 0.5, and Phase 1 increments 1-3 are DONE and gated (increment 3
with the live-update known limitation logged above).
