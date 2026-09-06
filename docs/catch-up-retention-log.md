# Catch-up retention change

Win condition: an authenticated owner can save and retrieve a generated summary for 30 days; cross-account reads, expired reads, retry extension, and surviving account deletion fail.

Scope: one migration, owner-scoped service and MCP tools, daily expiry cleanup, privacy/skill updates, export/deletion integration. Raw transcript prohibition and hosting/fronting semantics stay intact.

Implementation: server-owned 720-hour expiry, metadata-only retry receipts, filtered retrieval/export, revocation-aware access, expired-row cleanup despite revocation, backup exclusion. Versioned plugin 0.1.1 contains the updated skill. Verdict: keep. Validation passed: 79 server checks with PostgreSQL (including MCP round-trip, isolation, concurrent retries, exact expiry, revocation, deletion, and cron authentication), production build, lint, app/browser typechecks, 12 browser checks at 320px/390px/desktop and enlarged text, encrypted recovery with summary exclusion, and plugin packaging. Production activation requires migration 0009, CRON_SECRET, and verified scheduled cleanup; no production records were changed.
