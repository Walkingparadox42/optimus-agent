# Connectors mirror pattern — Joshu `src/connectors/*`

Design notes from a read-only inspection of the AGPL repo at `/root/scratch/joshu-oss`.
No code copied. The question I was evaluating: is the "mirror external data into local
markdown, let a semantic indexer read it" pattern worth adopting for my own BotVault?
Short answer: the *shape* is clean and worth borrowing; the specifics are Gmail/Nylas/
gbrain-flavored.

## The core idea

External accounts (mail, calendar) are **pulled into flat local markdown files**, one
file per logical object (email thread, calendar event). Each file is
`YAML frontmatter (metadata) + markdown body (content)`. The semantic indexer (gbrain)
then indexes that directory tree, so the agent can find external data by meaning via the
same path it uses for any local file — no live API call in the hot path. Live APIs are
used only to *refresh* the mirror. "Cache before live" is stated as a design rule
(`docs/platform-architecture.md`, "Cache before live").

## What gets written, and where

Layout is centralized in `src/connectors/paths.ts`, all under a single
`JOSHU_FILES_ROOT` (which resolves to the ArozOS Desktop tree — for me this would be a
BotVault subtree):

```
<FILES_ROOT>/connectors/
  mail/
    gmail/<accountKey>/threads/<safeThreadId>.md
    nylas/threads/<safeThreadId>.md
  calendar/
    google/<accountKey>/events/<safeEventId>.md
    nylas/events/<safeEventId>.md
  _state/
    gmail-sync.<account>.json          # per-account sync cursor
```
Evidence: `paths.ts:20-33` (mail dirs), `:44-52` (calendar dirs), `:16-17`
(`connectors/`, `connectors/_state`), `:39-42` (state path). Filenames are derived by
slugifying the external id — non-`[a-zA-Z0-9._-]` collapsed to `_`, length-capped, with
a fallback name (`safeThreadFilename`/`safeEventFilename`, `:73-83`). Provider + account
are part of the *path*, so multi-account and multi-provider coexist without collisions.

## File shape (one object = one file)

Written by `src/connectors/mirror.ts`. A mail thread file is:
- `---` YAML frontmatter block with a typed schema (`MailThreadFrontmatter`, `:26-52`):
  `source`, `external_id`, `thread_id`, `rfc_message_id` (RFC 5322 Message-ID, kept for
  **cross-mailbox dedup**), `from/to/cc/bcc`, `subject`, `labels`, `unread`, `synced_at`,
  `message_ids[]`, `thread_messages[]` (per-message meta for threaded UI),
  `connected_account_id` / `account_email` / `account_key` for multi-account.
- blank line, then the markdown body: HTML stripped to plain text
  (`stripHtmlToText`/`htmlToPlainText`) and **truncated to ~12k chars**
  (`truncateBody`, `:71-80`) so one giant email can't blow up the index.

Calendar events are the same idea with a smaller frontmatter (`title/start/end/
location/calendar_id/access_role/...`, `:54-70`).

The write itself is dead simple and **idempotent**: `mkdir -p` the dir, then
`writeFile` to the id-derived path (`writeMailThreadMirror`/`writeCalendarEventMirror`,
`:88-115`). Same thread id ⇒ same file path ⇒ the file is overwritten in place on each
sync. No append, no history, no partial-update logic — the file always reflects the
latest state of that object. That's what makes re-syncing safe to run repeatedly.

## How it's kept in sync

- **A Joshu-native scheduler**, deliberately independent of the agent runtime
  (`src/connectors/scheduler.ts` — header: "no Hermes gateway"). Default jobs poll every
  10 minutes (`DEFAULT_JOBS`, `:34-37`): one for Nylas, one for Gmail-via-Composio. Jobs
  live in a small JSON store (`connectors-cron.json`) with `lastRunAt`/`lastError`
  (`:26-33`, `readConnectorCronJobs`/`writeConnectorCronJobs`). The loop ticks every 60 s
  and runs whatever is due (`startConnectorScheduler`, `:120-160`; `parseEverySchedule`
  handles `every 10m`/`2h`/`1d`, `:98-110`).
- **Incremental vs full** (`syncHelpers.ts:runMailSync`): `incremental` (the 10-min cron)
  uses a narrow window / provider history cursor; `full` is for manual sync and first-time
  backfill. Gmail incrementality rides a `historyId`; Nylas rides a `cursor` — both stored
  in the per-account `_state` JSON (`state.ts:SyncState`, `:5-16`). So a routine sync only
  fetches deltas, not the whole mailbox.
- **`ifEmpty` guard** short-circuits a sync if the mirror already has threads
  (`syncHelpers.ts` `ifEmpty` branch) — cheap idempotence for "make sure something is
  there" calls.
- Sync results carry counts (`threadsWritten`, `eventsWritten`) so downstream steps can
  skip no-op work.

## How it gets indexed

Decoupled via a **touch-to-reindex nudge**, not a synchronous index call
(`src/connectors/gbrainIndex.ts`): after a sync that actually wrote files
(`threadsWritten + eventsWritten > 0`), `finalizeConnectorSyncForGbrain` calls
`requestBrainReindex()`, which just touches a file to wake gbrain's **debounced**
`sync_brain`. The file header notes the gbrain MCP bridge auto-commits
`${AROZ_DATA}/files/users/` (`git add -A`) before each index run
(`gbrainIndex.ts:1-4`, `:9-20`). So the pipeline is:

```
fetch deltas (cloud API)
  → write/overwrite <object>.md (frontmatter + body)      [mirror.ts]
  → update _state/<account>.json cursor                    [state.ts]
  → touch reindex flag                                     [gbrainIndex.ts]
  → (async, debounced) gbrain: git add -A + index          [MCP bridge]
  → agent queries via semantic search OR grep/ls on the tree
```

Because the data is *just markdown files in a git-committed tree*, it's simultaneously:
semantically searchable, greppable, diff-able across syncs, and human-readable/editable.
That triple-access (vector search + plain grep + git history) is the real payoff.

## What I'd take for BotVault (and what I'd change)

**Take:**
- One-object-per-file, `frontmatter + body`, filename = slugified stable external id →
  idempotent overwrite. This alone makes re-sync trivially safe.
- Provider/account as path segments; a `_state/` sibling dir for per-source cursors.
- Separate poller from indexer via a debounced touch flag — don't index synchronously in
  the fetch loop.
- Keep a stable cross-source dedup key in frontmatter (their `rfc_message_id`).
- Body normalization + a hard truncation cap before indexing.
- git-commit the tree so every sync is a diff and mistakes are recoverable.

**Change / watch out for:**
- The layout is welded to gbrain's expectation of living under
  `${AROZ_DATA}/files/users/*/Desktop` (`paths.ts` resolves via `resolveJoshuFilesPaths`).
  For BotVault I'd point `FILES_ROOT` at a vault subtree and drive **my** indexer, not
  gbrain (see the GBrain collision findings — running their gbrain would be a second
  indexer over the same tree).
- Overwrite-in-place means **no per-object history inside the file**; history lives only
  in git. If I want versions, that's a design choice to add.
- Truncating bodies to 12k chars is fine for search snippets but means the mirror is
  *not* a faithful archive of large messages — the full body still lives only in the
  source account. If BotVault is meant to be canonical, mirror the full body (or an
  attachment) and index a truncated view.
- Their scheduler is a naive 60 s in-process `setInterval`; fine for one box, but I'd
  likely hang sync off my existing job runner rather than a second timer.
