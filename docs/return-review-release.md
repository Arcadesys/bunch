# Return review redesign — release log

Win condition: an explicitly recorded fronting arrival opens that person's full recorded return window, and a host-composed MCP review is saved and displayed without a model API call.

Scope: three bounded batches, applied to origin/main c9c8360 in an isolated worktree. The original mixed checkout is preserved. Retain the newer friends pilot, account privacy controls, overlapping presence model, and 30-day summary retention from PRs #8–#10.

## Batch 1 — episode-linked persistence

Added migration 0010 without replacing legacy sessions or summaries. Fronting arrivals return catch-up details independently of the switch transaction. New versioned save validates owner, recipient, session, and revision, supports retry tombstones, and retains generated time, source client, categorized references, and coverage gaps. Unknown boundaries remain null. The existing 30-day cleanup still applies. Deleted/expired latest reviews do not resurface older revisions.

Added explicit paginated session reads; pages preserve the complete interval. Default reads use the latest current fronting episode. Explicit legacy hosting API reads remain compatible. Hosting changes never select a hosting catch-up in the website.

Verification: all 80 server/domain/protocol tests pass against disposable PostgreSQL, with no skipped checks. The new integration exercises a four-month window, 125 interval records plus older unresolved carryover across three pages, first arrival with unknown boundary, co-fronting, failed/mismatched writes, stale revisions, retry concurrency, and source/presence invariance. Existing migration, authentication, ownership, retention, and MCP contract checks pass. No model SDK or model API call was introduced.

## Batch 2 — navigation and visual foundation

Catch-up, History, People, Options navigation; navy surfaces, pink/orange accents, 20px base text, 18px minimum essential labels, 44px controls. Preserved light/device themes, reduced motion, focus outlines, and real profile media. Options retains Board, Notes, Threads, decisions, coverage, gallery, account/privacy, and client connection links. Existing URLs remain available.

## Batch 3 — remaining screens and acceptance

Saved narrative, source categories, coverage limitations, and explicit missing-review state. Reading a narrative performs no review or source mutation. Open record links, review actions, and todo completion remain separate. History defaults to seven days with wider date filters; this has no effect on catch-up windows. People retains exact saved identity fields and editing/media workflows.

Verification: 129 browser checks pass across 320px, 390px, and desktop. Includes doubled text reflow, keyboard/focus flows, target sizes, themes, source state separation, missing/saved review display, and delayed initial read protection, and direct links to older source records. Replaying an arrival after its episode ends retrieves the original catch-up without reopening presence. Inspected rendered phone and desktop captures. Lint, app/browser type checks, production build, plugin packaging, and encrypted backup/restore rehearsal pass. Backup rehearsal required matching PostgreSQL 17 client tools locally; summaries remain excluded from backups.

Release checks: production was read-only verified at migrations 0001–0009 with retention configured before migration. Live personal fronting records are not test fixtures. The automated host is a synthetic MCP client; these checks do not claim access to ChatGPT's private memory or prove that an existing ChatGPT connection has refreshed tool discovery.

Production migration: 0010 applied successfully after the staged build was ready. Domain promotion remains gated on the final PR revision.
