# Recorded fronting timeline

## Current implementation

- History at `/history` shows newest-first recorded intervals, local start/end timestamps, an explicit open-record label, inclusive calendar-date filters, and older-page loading.
- `list_fronting_history` supports explicit-offset `from` (inclusive), `to` (exclusive), optional `alterId`, bounded `limit`, and keyset `before` pagination. Resolve names using `list_alters`.
- `GET /api/v1/fronting/history` uses the same service behind owner authentication and returns private, no-store responses.
- Sessions overlapping the range are returned with original timestamps. Archived profiles remain visible. Missing records never establish absence. Names reflect the current profile name; historical name snapshots are not stored.
- No new migration: reads existing confirmed `fronting_session` records.

## Follow-up: distinct hosting and fronting periods

The initial single-front timeline above has been extended by the hosting/fronting model pass. History now includes typed periods and separately labeled legacy records. See `hosting-fronting-model.md` for the current contract, migration, verification, and remaining legacy UI/catch-up boundaries.
