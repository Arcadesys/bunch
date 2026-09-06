# Hosting periods and fronting episodes

Win condition: hosting responsibility and overlapping fronting episodes have independent persisted lifecycles, preserved legacy records, and owner-scoped DIDdy reads/writes.

Scope: one model/service/MCP pass, with history labels updated to expose the distinction. No live private records were changed. No hosted migration or deployment was performed.

## Model

`presence_period` stores `kind` (`HOSTING` or `FRONTING`), owner/profile IDs, start/end timestamps, a version, and provenance (`origin`).

- **Hosting:** responsibility for everything otherwise unclaimed throughout the period. One open hosting period per owner follows the existing single-host contract.
- **Fronting:** independently recorded episodes. Different alters can have open episodes simultaneously, including across a host handoff. One open fronting episode per alter prevents duplicate recording. A host may also have a separately reported fronting episode.
- There is no duration limit or automatic expiry. A missing end means only that no end was recorded. A recorded host is not a prerequisite to saving an explicit fronting report.
- Existing task/coverage assignments remain independent. This change records hosting responsibility; it does not rewrite individual claims or assign todos automatically.

`system_host` remains the versioned current-role compatibility record. A database trigger closes/opens hosting periods atomically on a changed host; clearing closes the hosting period. Reaffirming the same host does not split the period. Fronting operations never write `system_host`.

New fronting start/end operations record the time of the explicit report. End requires the exact episode ID and version. Mutations are owner scoped, audited, serialized per owner, and retry safe through the existing request receipt mechanism. Archived profiles cannot start new episodes but existing episodes can still be ended. Permanent profile erasure cascades periods consistently with the existing front-history erasure policy.

## Migration and compatibility

Migration `0006_hosting_fronting_periods.sql` seeds only an explicitly recorded non-null current host, using its existing `recorded_at` and `SYSTEM_HOST_SNAPSHOT` provenance. This is a recorded timestamp, not a recovered actual onset. Cleared/never-recorded hosts produce no period. Earlier hosting history is not fabricated.

The migration does not alter or copy `fronting_session`. History returns those rows separately as `LEGACY_FRONT` / `LEGACY_RECORD`; no automated hosting/fronting reclassification occurs.

Apply the migration before deploying the new server. Migration execution was verified only against disposable local PostgreSQL. Re-running the migration runner performs no additional migration.

## Shared interfaces

- `get_current_presence`: active hosting period, array of fronting episodes, and a separately labeled `legacyCurrentFront` compatibility record.
- `start_fronting_episode`: explicit start now; leaves the host and every other episode intact.
- `end_fronting_episode`: explicit end now, with episode ID and expected version.
- `set_system_host`: existing versioned hosting setter now retains period history.
- `list_fronting_history`: combined history with `kind`, `origin`, date overlap, optional kind/profile filters, and a cursor carrying timestamp, ID, and kind. Cursor timestamps retain database precision.
- HTTP: `GET /api/v1/presence/current`, `POST /api/v1/presence/fronting/start`, `POST /api/v1/presence/fronting/end`; existing history endpoint returns the combined history. Owner authentication and mutation origin checks remain in place.

The History page labels Hosting, Fronting, and unclassified legacy records. Web controls now start/end either experience independently. The expandable state display shows hosting, all open fronting episodes, and their selected profile pictures. It lives in the existing catch-up header so phone users can still see the first item immediately.

Migration `0007_presence_catch_up.sql` permits exactly one legacy or typed-period source per catch-up session, with owner-scoped foreign keys and uniqueness. Existing sessions retain their legacy links. New saved-record catch-ups select an active period and use the prior ended period of that same kind for the same alter as a recorded window. More than one active period requires explicit selection. Reviews retain their own session and never complete the underlying record.

ChatGPT catch-up offers the same period selector; lineup and cached companion displays distinguish hosting from fronting. The read-only conversation handoff accepts a selected periodId, preserves explicit date/offset handling, and still requires a capable host to retrieve conversations. It does not create sessions or import transcripts. Legacy tools remain available for compatibility and are described as legacy; the new web controls do not invoke exclusive switches.

## Verification log — 2026-09-05

**Keep:** 42 server/contract tests passed with no skips against local PostgreSQL, including migration provenance/preservation, overlapping episodes, independent ends, host handoffs, ownership, archive behavior, invalid ranges, singleton constraints, concurrent start/end conflicts, retries, mixed-history pagination, and MCP tool contracts.

**Keep:** nine browser checks passed across 320px, 390px, and desktop. Inspected the 320px overlap screenshot: labeled types, readable start/end timestamps and responsibility text, no horizontal scrolling.

Lint, application and browser typechecks, and whitespace checks passed.

The first new integration run exposed a fixture comparison between JSON-stripped optional fields and a service read containing `undefined`; normalizing that fixture comparison resolved it. No behavior assertion was removed.

Stopping point: local model and shared interfaces verified. Live deployment and authenticated hosted DIDdy execution remain unverified.


## Integration and PR pass — 2026-09-05

Win condition: finish the web controls, current-state displays, and catch-up integration, then open a PR against current main without unrelated local work.

The source checkout was behind merged main. Work continued in an isolated `codex/hosting-fronting-flow` worktree based on `0be74cb`; existing conversation-handoff and private-image behavior was retained. Unrelated OAuth, plugin, and upload edits in the original checkout were excluded.

Verification: 51 server tests pass against local PostgreSQL, including the new period-linked saved-record catch-up and read-only conversation handoff. Production build, lint, and application/browser typechecks pass. Browser verification covers independent start/end, explicit confirmation, stale host versions, lost-response retries, double submits, pagination, selection races, review persistence, private profile UI, and phone reflow.

Kept fixes from verification: corrected the lineup response to include its declared presence object, made the profile select label explicit, restored focus after cancel, and compacted the state display into the catch-up header to preserve first-screen readability. Test selectors now identify catch-up rows and notices rather than assuming the first article/status is the target.

Hosted migration and production deployment are not part of this PR operation. Apply migrations 0005–0007 before deploying the new server. No hosting/fronting state was changed in the live system.

Final integration verdict: **Keep**. All 108 browser checks passed against the production build at 320px, 390px, and desktop. The phone first-screen acceptance check still passes, including the first catch-up item. Inspected the final phone screenshot. All 51 server checks passed without skips; lint, both typechecks, build, and whitespace checks passed.


## Automatic ChatGPT catch-up after an arrival

A confirmed arrival through DIDdy now directs ChatGPT to prepare and generate a conversation summary without requiring a separate catch-up request. “Last switch” means the incoming alter's previous recorded departure of the same experience kind. The end is the new arrival timestamp. Hosting and fronting histories remain independent; this window never establishes absence from another experience.

The handoff returns `elapsedSeconds`, calculated from the recorded instants. Exact period/session IDs preserve the arrival cutoff even after that period ends. Missing prior history returns `NEEDS_DATES`. Host reaffirmations, clearing hosting, episode ends, and completed retries do not request another summary.

ChatGPT must read available messages, report topics, decisions, open matters and coverage gaps, and show the window and duration. DIDdy does not automatically receive ChatGPT history. Once the host generates a grounded summary, it saves that synthesis with its window and coverage gaps for 30 days using `save_conversation_catch_up`; raw transcripts remain prohibited. This is a ChatGPT MCP follow-up; a website mutation cannot independently start a ChatGPT conversation. Runtime history retrieval and generation depend on the connected host's capabilities.

Verification for this follow-up: duration and DST checks, pinned source selection, mutation follow-up instructions, retry/clear exclusions, and database-backed hosting timestamp matching. No additional migration or production record change is needed.

## Repeatable evals — 2026-09-05

Run `TEST_DATABASE_URL=<disposable migrated PostgreSQL URL> npm run eval:mcp` for five synthetic scenarios through the real MCP transport and services. The command requires a database and fails rather than silently skipping when it is absent. The same suite runs in the existing CI server-test step.

| Scenario | Result |
| --- | --- |
| Returning front overlaps hosting and uses its own prior departure | Pass |
| Hosting uses hosting history, not the fronting departure | Pass |
| Retry and subsequent end preserve the original arrival cutoff | Pass |
| First arrival requests dates without inventing a duration | Pass |
| Handoff discloses host access, rejects another owner's profile, and creates no catch-up session | Pass |

`MOBILE_TEST_SERVER=production npm run eval:mobile`: 63 passed across 320px, 390px, and desktop. These include explicit experience changes, confirmation/cancellation, failed saves, stale versions, overlapping episodes, readable first-screen content, large-text reflow, and target sizes.

Full local verification: 60 server checks passed without skips, production build passed, lint passed, application/browser typechecks passed, and whitespace checks passed. No application implementation changes were needed during this eval pass.

These are deterministic protocol and browser acceptance evals. They verify the data and instructions provided to ChatGPT, not model compliance, summary factuality, or live cross-conversation retrieval. Live ChatGPT acceptance still requires a host with the relevant history capabilities. No private user records or conversation transcripts were used.
