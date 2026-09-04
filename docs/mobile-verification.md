# Mobile catch-up verification — 2026-09-04

## Scope and win condition

Ship the website catch-up prerequisites and mobile repairs with all 84 browser
checks passing at 320px, 390px and desktop, plus durable PostgreSQL coverage.
One focused PR, independently checked from the existing dirty workspace.

## Included

- Catch-up pages, records, review-state contracts and additive migration 0004.
- Accessible navigation and Appearance controls, 44px project touch targets,
  long-content reflow and 200% root-text enlargement checks.
- Truthful loading/error/auth states, retry, safe form reset and duplicate guards.
- Explicit front-switch confirmation, exact session concurrency guard,
  idempotent retry and protection against stale reads replacing confirmed state.
- Existing main-branch profile/media manager moved to `/profiles`, with safe
  post-await form reset. No new profile-picture workflow is included.

## Isolation

Unrelated local profile-picture, MCP/widget, OAuth and plugin changes are excluded.
Migration 0003 belongs to the separate profile-picture work; 0004 is independently
applicable after the existing 0001 and 0002 migrations. Keep its filename stable
because other environments may already have recorded that migration name.

Browser tests use synthetic records and block unhandled API/external requests.
Database tests ran on a fresh disposable local database initialized with
`db/baseline.sql` and only this branch's migrations. No production records changed.

## Exact-branch verification

- `npm ci --ignore-scripts`: passed.
- `npm run build`: passed.
- `MOBILE_TEST_SERVER=production npm run test:browser`: 84 passed, no skips.
- `TEST_DATABASE_URL=... npm test`: 23 passed, no skips.
- `npm run typecheck` and `npm run typecheck:browser`: passed.
- `npm run lint`: zero errors; existing gallery `no-img-element` warning.
- `npm run db:check` and `git diff --check`: passed.

The first build attempt rejected a dependency symlink outside the worktree.
Installing dependencies directly in the isolated worktree resolved that setup
issue; the passing build and browser run used those installed dependencies.

Verdict: kept. This is source, local production-bundle and database evidence,
not authenticated production or real-device acceptance. Safari, screen readers,
private media, actual page zoom and mounted ChatGPT widgets remain separate gates.
