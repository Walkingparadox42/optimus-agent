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

## Phase 4 — Voice (not started)

**OPEN QUESTION (blocking, decide before any voice-client code):** does the
Electron renderer own the mic and speak :9125 directly, or does a separate
MiniPC wake/audio client own audio while the cockpit consumes the fanned-out
event feed via event-protocol.md?

Context: docs/cockpit-reference/voice-protocol.md specs the :9125 WS as the
contract between the "MiniPC wake/audio client" and the CT115 voice service —
wording that implies the audio client may be its own process, not the
renderer. The cockpit UI is described as consuming voice.* / agent.* / tool.*
event families fanned out per docs/architecture/event-protocol.md, which
lives on CT115 and is NOT yet in this repo.

Prerequisites before Phase 4 starts:
1. Answer the open question above (Steve / CT115-side architecture call).
2. Copy docs/architecture/event-protocol.md from CT115 into
   docs/cockpit-reference/.
3. CT115 :9125 service live and reachable (spec is LIVING; binary frame
   header still PROPOSED — expect wire changes until it firms up).

Downstream notes: whichever way the question resolves, `$avatarListening`
(src/store/avatar.ts) is the seam the listening state plugs into; ADR-0008
(mic stays live during TTS, pausing capture banned) binds the audio owner.

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
