# Camofox browser-control reference notes — Joshu HITL browser stack

Design notes from a read-only inspection of the AGPL repo at `/root/scratch/joshu-oss`.
No code copied. Purpose: learn how Joshu wires a headed, shared, agent-driven browser
with human takeover, as reference before building Phase 6 (a LAN-local browser-control
service on CT115 with a viewport streamed into an Electron cockpit).

**Their setup vs mine.** Joshu runs **Camofox** — a stealth Firefox fork shipped as a
GHCR Docker image (`ghcr.io/jo-inc/camofox-browser@sha256:…`, `deploy/RELEASE.json`
`camofoxBase`) — as a **separate container** the agent and human share. Mine is
LAN-only, single-user, and I'll run my own Camofox/Playwright/Chromium on CT115. I'm
harvesting the **control/streaming/handoff shape**, not their container, proxy, or
multi-tenant assumptions.

**File map (evidence):**
- `src/camofox.ts` — health probe + noVNC embed URL builder
- `src/camofoxSession.ts` — the tab-control client (talks to Camofox's HTTP API)
- `src/actionGuard/browserGate.ts` — owner-approval gate for agent browser writes
- `src/hermesBrowserSyncPolicy.ts` + `src/hermesApi.ts:463` — how live page context is fed to the agent
- `scripts/ensure-camofox-container.sh` — how the container is created (ports, VNC, single-tab)
- `scripts/hermes-browser-camofox-hitl.patch` — how the agent adopts the shared tab
- `docs/hitl-camofox-notes.md`, `docs/agent-safety.md` — the human-in-the-loop model

---

## 1. Architecture — what actually runs the browser

**A containerized, headed Firefox (Camofox) driven over an HTTP tab API; Playwright is
the automation layer *inside* Camofox, not something Joshu speaks directly.**

- Camofox runs as its own Docker container (`camofox-hitl`) with a **headed** Firefox on
  a virtual X display (`ENABLE_VNC=1`, `VNC_RESOLUTION=1024x768`, launched under the
  image's own Xvfb; `scripts/ensure-camofox-container.sh` `docker run … -e ENABLE_VNC=1
  -e VNC_RESOLUTION=…`). It is headed *and* streamed — the point is that a human can see
  and touch it (§2, §4).
- The container exposes **two loopback ports**: `127.0.0.1:9377` (an HTTP control API)
  and `127.0.0.1:6080` (noVNC/websockify). Both bound to localhost in the run command.
- Joshu (Node) and Hermes (Python agent) drive the browser via **REST calls to `:9377`**,
  not raw CDP/WebDriver from Joshu. The client is `CamofoxSessionCoordinator`
  (`src/camofoxSession.ts`), a thin HTTP wrapper over a tab-oriented API:
  `GET /tabs`, `POST /tabs`, `POST /tabs/:id/navigate`, `POST /tabs/:id/viewport`,
  `POST /tabs/:id/evaluate`, `GET /tabs/:id/snapshot`, `DELETE /tabs/:id`, `GET /health`
  (all constructed in `camofoxSession.ts`; `getCamofoxStatus` hits `/health` in
  `src/camofox.ts`).
- **Playwright lives behind that API, inside Camofox.** The coordinator comment is
  explicit — "Resize Playwright viewport and Firefox outer window to match the VNC
  framebuffer" (`camofoxSession.ts`, `readViewportMetrics`/`fitViewport`). So the stack
  is: agent/Joshu → HTTP `:9377` → Camofox server → Playwright → headed Firefox on Xvfb.
- **Process/container boundary:** the agent never touches the browser process directly.
  Everything crosses an HTTP boundary to the Camofox container. That single indirection
  is what lets two very different consumers (the Node app and the Python agent) — plus a
  third, the VNC viewer — all act on one browser without sharing a driver handle.

## 2. Viewport streaming — how pixels reach the UI

**It's VNC, surfaced through noVNC — a full framebuffer stream, not screenshots and not
CDP screencast. URL/title/loading state travel on a completely separate channel.**

- Camofox's headed Firefox renders to Xvfb; a VNC server exports that framebuffer;
  **noVNC + websockify** (`:6080`, path `/websockify`) stream it to a `<canvas>` in the
  UI. Joshu proxies the WS: `/joshu/novnc/websockify` → Camofox `:6080/websockify`
  (`src/server.ts:105`, `handleNovncUpgrade` at `:106-129`, which rewrites the path and
  strips WS-compression headers before `proxy.ws(...)`). The embed is a standalone viewer
  page (`buildNoVncStandaloneUrl` → `camofox-viewer.html`, `src/camofox.ts`), and the
  status payload hands the client `novnc.clientBaseUrl` + `websocketPath`
  (`getCamofoxStatus` in `src/camofox.ts`).
- **Cadence/format = whatever RFB/VNC does:** incremental dirty-rectangle framebuffer
  updates pushed over the WebSocket on change, not a fixed screenshot interval. The repo
  doesn't configure an encoder or FPS — it relies on the Camofox image's VNC server, so
  latency is "kept reasonable" mostly by (a) it being loopback and (b) VNC's incremental
  updates. There is no CDP `Page.screencast`, no WebRTC, no periodic PNG polling anywhere
  in the code.
- **Fixed 4:3 framebuffer (1024×768)** and the app resizes the *browser* to match the
  *framebuffer*, not the other way round: `fitViewport` POSTs `/tabs/:id/viewport`
  {width:1024,height:768} and `readViewportMetrics` reads `window.innerWidth/…` via
  `evaluate` to verify alignment (`src/camofoxSession.ts`). There's an explicit bootstrap
  route `POST /joshu/api/camofox/fit-viewport` (`docs/hitl-camofox-notes.md:66`). This
  pixel-alignment step is what stops the noVNC canvas from showing scrollbars or a
  mismatched region.
- **URL / title / loading-state are NOT in the pixel stream.** They come from the HTTP
  API: `GET /tabs` returns `{tabId,url,title,listItemId}` and `GET /tabs/:id/snapshot`
  returns `{url,title,snapshot,refsCount}` (`camofoxSession.ts` `listTabs`/`observe`).
  Joshu reads those and injects them into the agent's turn as text (§3, §4). So there are
  effectively **two synchronized streams**: pixels over VNC (for the human) and
  URL/title/DOM-snapshot over HTTP (for the agent).

## 3. Agent control — how actions are issued

**Typed verbs against a DOM/accessibility snapshot with element refs — not
coordinate-based, not raw input injection.**

- The agent (Hermes) has a `browser_camofox.py` tool that calls the same `:9377` API. The
  verbs are a small declared set: `navigate`, `click`, `type`, `press`, `evaluate`,
  `snapshot`/`observe`, `viewport` (the action guard enumerates the "write" verbs as
  click/type/press/evaluate — `src/actionGuard/browserGate.ts`; `docs/agent-safety.md:144-146`).
- Element targeting is **snapshot-ref based.** `observe` returns a `snapshot` string plus
  `refsCount` (`camofoxSession.ts`, `CamofoxPageObservation`) — i.e. an accessibility/DOM
  tree with stable ref ids the agent selects from, the Playwright-style "observe then act
  on a ref" model. This is the "declared verbs / typed actions" approach, not pixel
  coordinates. (Coordinates would be fragile against the VNC canvas anyway.)
- `evaluate` runs arbitrary JS in the page and is used by Joshu itself for housekeeping
  (installing the tab shim, reading viewport metrics — `camofoxSession.ts` `installShim`,
  `readViewportMetrics`). Because `evaluate` can read/write anything, it's classified as a
  write for gating purposes (§4).
- A per-tab **JS shim** is injected on every observe/ensure (`HITL_TAB_SHIM` in
  `camofoxSession.ts`) whose job is to force single-tab behavior: it rewrites
  `target=_blank`/`_new` anchors and forms to `_self`, intercepts modifier/middle clicks,
  and overrides `window.open` to same-tab navigation. This keeps every action on the one
  visible tab the human is watching — nothing opens in an off-screen tab. Combined with
  `MAX_TABS_*=1` / `HITL_FORCE_SINGLE_VISIBLE_PAGE=true` at the container
  (`ensure-camofox-container.sh`) and `closeOtherTabs` in the coordinator.

## 4. Shared control / auth handoff (the important part)

**The core trick: the agent and the human operate ONE shared headed browser. The human's
control path (noVNC) is a first-class, always-on, ungated channel that bypasses the agent
entirely. "Handoff" is therefore not a mode switch or an input-forwarding protocol — it's
that the human input path always exists, and the *agent's* actions are what get paused.**

**Shared-tab model.** Joshu owns a single managed tab keyed by `userId`+`sessionKey`
(`HITL_CAMOFOX_USER_ID=hitl-camofox`, `HITL_CAMOFOX_SESSION_KEY=hitl-main`,
`src/server.ts:189-190`). Tabs carry `listItemId === sessionKey` (`camofoxSession.ts`
`currentTab`). The agent does **not** open its own tab — the Hermes patch makes it *adopt*
the existing managed tab: `_adopt_existing_tab` matches `listItemId == session_key` and
rehydrates `tab_id` from Camofox before it would ever create a new one
(`scripts/hermes-browser-camofox-hitl.patch`; Hermes config `browser.camofox.user_id`,
`session_key`, `adopt_existing_tab: true`, `docs/hitl-camofox-notes.md:54-55`). So agent
actions and the human's noVNC actions land on the same live page.

**Two independent control planes onto one browser:**
- **Human plane = noVNC/RFB.** Mouse/keyboard events go WebSocket → websockify → VNC →
  Xvfb → Firefox, directly. They never pass through Joshu or Hermes, are never turned into
  text, and are never sent to an LLM. `docs/agent-safety.md:22` states it outright: "Owner
  human UI bypasses — … owner browser sessions (jWeb / noVNC) are **not agent paths**."
- **Agent plane = HTTP `:9377`** verbs (§3), each of which *can* be gated.

**"Agent pause, human drive" is the action guard, not a takeover flag.** When
`browserGateWrites` is on (`JOSHU_ACTION_GUARD_BROWSER_GATE=true`, default **off**), every
agent **click/type/press** first calls `POST /joshu/api/action-guard/browser` →
`gateBrowserWriteRequest` → `awaitOwnerApproval` (`src/actionGuard/browserGate.ts`;
`docs/agent-safety.md:148-158`). This is the **same** single HITL gate used for mail sends
— one pending store, one resolve path; Telegram callbacks / Slack replies / signed URLs are
ingress only (`docs/agent-safety.md:20`). So during a login the human can simply drive via
noVNC while the agent's attempts to act sit behind owner approval.

**Deny/timeout returns a success-shaped stub, not an error.** A denied or timed-out agent
write resolves to `stubBrowserActionResponse(...)` — a response shaped like a normal
success with no side effect (`browserGate.ts`; `docs/agent-safety.md:31,124`). Rationale:
the agent doesn't see a gate, so it doesn't retry-loop or try to route around it. Worth
copying — a naive "permission denied" makes agents thrash.

**How credentials avoid being logged/captured during the handoff window:**
- The human types passwords/2FA **through noVNC**, which is not an agent path — those
  keystrokes exist only as RFB input events + framebuffer pixels, never as Joshu/Hermes
  text or LLM context (`docs/agent-safety.md:22`). Password fields render as masked dots in
  the framebuffer.
- The agent only "sees" page content when it explicitly calls `snapshot`/`observe`, and
  `type`/`evaluate` (the ways it could read/inject field values) are classified as gated
  writes. `evaluate` is the dangerous one (it can read `input.value`); the doc admits
  `evaluate/submit` are "classified as writes; Hermes patch does not hook them yet"
  (`docs/agent-safety.md:146`) — an acknowledged gap, not a guarantee.
- **Caveat worth flagging for my build:** the *context-sync* heuristic actually escalates
  the wrong way for secrecy. `resolveBrowserSyncLevel` returns **`full`** (ships the live
  DOM/a11y `snapshot` into the LLM system message, truncated) when the URL changed or the
  user text matches browser intent — and that intent regex explicitly includes
  `sign in|log in` (`src/hermesBrowserSyncPolicy.ts` `BROWSER_INTENT_RE`;
  `buildBrowserSyncSystemMessage` full branch in `src/hermesApi.ts:463`). So "log in" phrasing
  makes it *more* likely to inject the page snapshot, not less. The real credential
  isolation here is purely architectural (human types via noVNC), **not** a
  password-field-aware redaction. If I want redaction I have to add it — their design
  relies on the human-plane bypass, and on keeping sync at `light` (URL+title only) when
  you don't want DOM shipped.

**Sync-after-handback.** Because the human may have changed the page mid-handoff, the
`light`/`full` sync messages both *lead* with "the human may have changed the shared tab in
noVNC since your last turn; older browser tool output may be stale; snapshot/observe before
acting" (`src/hermesApi.ts:463` both branches). That's their "hand back to agent" signal:
there's no explicit event — the agent is simply told, every turn, that the shared tab is
authoritative and prior observations are stale, and instructed to re-observe. Cheap and
robust; no handoff state machine to get wrong.

## 5. Session / cookie persistence

- The authenticated profile is **inside the Camofox container** (its Firefox profile on
  the container filesystem). Sessions are namespaced by `userId`+`sessionKey`; the managed
  tab is found via `listItemId === sessionKey` (`camofoxSession.ts` `currentTab`,
  `createTab` sends both). Multi-user isolation in their fleet is one Camofox per box plus
  this user/session keying.
- **Persistence across restarts is container-lifetime bound, and in the local-dev path
  there is no dedicated profile volume.** `ensure-camofox-container.sh` runs with
  `--restart unless-stopped` and only mounts `-v ${ROOT_DIR}:/opt/joshu:ro` (read-only,
  just to load the single-tab patch). Cookies survive `docker stop/start` (same writable
  layer) but **not** `docker rm` — and the doc's Camofox-bump procedure is literally
  `docker rm -f camofox-hitl && ensure-camofox-container.sh` (`docs/hitl-camofox-notes.md:28`),
  i.e. bumping the image drops the profile. (In the packaged box image, Camofox is baked
  into the main container with its own volumes — see the box compose — but this HITL
  sidecar path has no explicit cookie volume.)
- **Outbound identity via proxy (their multi-tenant/stealth concern):** if `PROXY_*` env
  is set, the container is (re)created with a residential-proxy pool so browsing exits via
  the proxy rather than the box IP (`ensure-camofox-container.sh` `camofox_proxy_env_args`,
  `container_has_proxy_env`). Pure cloud-fleet concern; irrelevant to a LAN build.

---

## TAKE THIS / CHANGE THIS for my LAN-local build

**TAKE (ports cleanly to self-hosted Camofox/Playwright/Chromium + Electron cockpit):**
- **The three-plane split:** one headed browser; a pixel stream for the human; an HTTP verb
  API for the agent; URL/title/DOM-snapshot as a separate text channel. This is the whole
  design and it's framework-agnostic.
- **Shared single tab + adopt-existing.** Have the agent attach to the *same* page the human
  sees rather than spawning its own context. The `listItemId==sessionKey` "find and adopt"
  pattern and the single-tab shim (rewrite `_blank`, override `window.open`) keep everything
  on-screen. Directly reusable.
- **Human plane bypasses the agent entirely.** Whatever streams my viewport (see below) must
  forward the human's input straight to the browser, never through the agent/LLM. That
  single rule is what makes 2FA safe — copy it verbatim in spirit.
- **Per-action owner gate with success-shaped stubs on deny/timeout.** Gate agent
  click/type/press/**evaluate**, and return a benign no-op-shaped result on deny so the agent
  doesn't thrash. (Fix their acknowledged gap: actually hook `evaluate`/`submit`, since those
  are how an agent would read a password field.)
- **"Tab may have changed — re-observe" every turn** instead of a handoff state machine.
  Cheap staleness handling that survives arbitrary human interaction.
- **Fit the browser viewport to the stream's framebuffer** (not vice-versa) so the canvas
  is pixel-aligned; expose an explicit fit/resize call.
- **Snapshot-ref action model** over coordinates — robust against a scaled canvas.

**CHANGE / doesn't apply (their cloud/GHCR/multi-user assumptions):**
- **Streaming transport is my biggest decision, and theirs (VNC/noVNC) is a *choice*, not a
  requirement.** VNC is simple and gives me the human-input channel for free (RFB carries
  input back), which is a real plus for handoff. But for an Electron cockpit I could instead
  use **CDP `Page.startScreencast`** (JPEG frames + `Input.dispatch* ` for human events) for
  lower latency and DOM-coordinate fidelity — at the cost of building the input-forwarding
  path myself. Their design leans on VNC precisely because it bundles pixels+input; if I go
  CDP/WebRTC I must re-create the "human input bypasses the agent" guarantee explicitly.
- **The GHCR image, `camofoxBase` digest pin, `sync-camofox-pin`, and the build-time
  `patch-camofox-single-tab.mjs`/Hermes patches** are their release plumbing — skip entirely;
  I control my own image/binary.
- **Residential proxy pool (`PROXY_*`) and stealth-Firefox fingerprinting** are anti-bot /
  multi-tenant concerns. On a LAN, single-user, I don't need Camofox's stealth at all —
  plain Playwright-Chromium is fine unless a specific site fights me.
- **Multi-user/session keying, per-box container, no-profile-volume lifecycle.** Single-user
  simplifies this: I can run one persistent browser with a **real, mounted profile volume**
  so cookies survive image upgrades (their local sidecar loses the profile on `docker rm` —
  don't copy that; mount the profile dir).
- **Owner-channel-over-Telegram/Slack approval ingress.** My gate can just be a cockpit
  button (approve/deny in the same Electron UI) instead of routing through a chat bot — same
  `awaitOwnerApproval` shape, local transport.
- **The `light`/`full` sync heuristic that escalates to full DOM on "log in".** Invert this
  for credential safety: detect password/sensitive fields (or just the login flow) and force
  **light** context (URL+title only) so page DOM with typed values is never shipped to the
  LLM. Add real field redaction; don't inherit their gap.

---

*These notes stand alone — every claim is cited to a file (and line where stable), so the
clone at `/root/scratch/joshu-oss` can be deleted after this. The one thing lost on deletion
is the ability to re-open `src/camofoxSession.ts` / `scripts/hermes-browser-camofox-hitl.patch`
while implementing; if Phase 6 is imminent, keep it a few more days, otherwise `rm -rf` is
fine and re-cloning is one command.*
