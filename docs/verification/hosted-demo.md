# Hosted Demo system verification

Win condition: a labeled, fictional system can be explored through Bunch's normal plugin HTTP connection, while private records remain isolated behind authentication.

## Kept iteration

Eight read tools expose the full sample, people, person details, filtered tasks, filtered notes, presence, history, and Benny's catch-up. Demo tools use a separate fixture-only server for anonymous requests. Invalid supplied credentials never fall back to fiction. Private tool names and mutation paths remain authenticated. Stream probes return 405 for anonymous visitors instead of initiating OAuth.

The sample directly names Fenton, Benny, and Dot. It preserves their stated relationships, separate hosting/fronting, shared relevance, and Fenton's reminder for Benny to write a thank-you note for the system's gift. No donor, gift type, deadline, species, or new family relationship is invented.

## Local evidence (2026-09-09)

- `npm run lint`: pass.
- `npm run typecheck` and `npm run typecheck:browser`: pass.
- `npm run test:ci` against a disposable local PostgreSQL 16 database: 113 pass, zero failures/skips/TODOs. Includes signed-token HTTP routing with two synthetic tenants and cross-tenant read rejection.
- `npm run build -- --webpack`: pass. Webpack is used locally because dependencies are linked from the existing checkout; CI uses the ordinary build command.
- `MOBILE_TEST_SERVER=production npm run test:browser -- hosted-demo.spec.ts`: six pass across the three configured projects. These are HTTP/protocol checks, not visual UI acceptance. A real MCP SDK client initializes the endpoint, discovers tools, and follows people → tasks/notes → history/presence → catch-up. Private reads/writes and invalid bearer tokens are rejected.
- Plugin manifest validation, skill validation, and versioned package creation: pass.

The initial full-suite run caught a missing connection-tool output schema; it was added and the entire suite rerun. The anonymous stream response was corrected after an HTTP-client probe. The current kept implementation has both fixes.

## Remaining delivery evidence

Required GitHub CI and merge are tracked on the PR. Production deployment and public API probes must be reported separately. Local protocol validation does not claim installation or OAuth consent in a particular user's Codex account. The repository marketplace and stable installation guide provide the supported setup path; the read-only demo needs no account.
