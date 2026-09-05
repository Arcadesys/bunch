# Recorded fronting timeline

Win condition: History shows who was recorded out and when, and DIDdy answers historical fronting questions from the same owner-scoped source.

Scope: one implementation pass across the shared query contract, service, API, MCP tool, History UI, and focused checks. Existing unrelated changes preserved. No private records changed and no deployment performed.

## Current implementation

- History at `/history` shows newest-first recorded intervals, local start/end timestamps, an explicit open-record label, inclusive calendar-date filters, and older-page loading.
- `list_fronting_history` supports explicit-offset `from` (inclusive), `to` (exclusive), optional `alterId`, bounded `limit`, and keyset `before` pagination. Resolve names using `list_alters`.
- `GET /api/v1/fronting/history` uses the same service behind owner authentication and returns private, no-store responses.
- Sessions overlapping the range are returned with original timestamps. Archived profiles remain visible. Missing records never establish absence. Names reflect the current profile name; historical name snapshots are not stored.
- No new migration: reads existing confirmed `fronting_session` records.

## Verification log — 2026-09-05

Keep: 37 server/contract tests passed against a disposable local PostgreSQL database with baseline and migrations 0001–0005, including real interval-boundary, pagination, archive, and owner-isolation checks, plus an in-memory MCP tool call.

Keep: six browser checks passed across 320px, 390px, and desktop for recorded intervals, filters, older records, failed-read versus empty-state distinction, retry, and absence of writes. Inspected the 320px screenshot: large text, labeled intervals and controls, no horizontal overflow.

First test pass found fixture assumptions: PostgreSQL date-only literals used the database timezone, development mode repeated initial reads, and Next.js added a second alert region. Corrected fixtures to explicit UTC instants and scoped browser assertions to the actual request and main content.

Lint, application typecheck, browser typecheck, and whitespace checks pass. The initial abortable network read has a narrowly documented effect lint exception.

Local verification only. Hosted deployment and a live authenticated DIDdy call remain unverified.

## Follow-up: distinct hosting and fronting periods

The initial single-front timeline above has been extended by the hosting/fronting model pass. History now includes typed periods and separately labeled legacy records. See `hosting-fronting-model.md` for the current contract, migration, verification, and remaining legacy UI/catch-up boundaries.
