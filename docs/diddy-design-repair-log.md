# DIDdy design repair — 2026-09-04

Win condition: saved records have permanent views; actions and identity language match actual behavior; navigation and readable layouts work across the app without disrupting existing work.

Budget: one local implementation batch, three delegated workstreams, followed by integrated verification. No commits, deployment, or production record changes.

## Kept changes

- Board, Notes, and Threads list stored records independently of the current catch-up. Creation refreshes the list immediately, pagination remains available, and recipients/assignees use actual profile choices.
- Board provides real todo completion/reopen actions. Catch-up and the embedded widget use Mark reviewed and Review later; existing review-state contracts remain intact.
- Fronting copy describes recorded events rather than absence or return. Unavailable reads do not claim empty private records. Widget initials derive from the supplied record instead of a hardcoded identity.
- Shared DIDdy navigation uses the existing plural-rings asset. Appearance/sign-in are accessible through Options. Supporting text has a 20px base, reviewed items retain contrast, and rows follow a single reading path.
- Profiles lead with the lineup and named images. Editing stays beside each profile; coverage has its own disclosure. Profile forms bind their own target IDs so creating a new profile cannot overwrite an open editor's profile.
- Saved demo thread suggestions persist across reads within the demo service and remain owner-isolated. Production records retain the existing database-backed paths.

## Verification and revisions

- Initial integrated browser run: 91/93 passed; phone first-screen layout failed. Replaced oversized navigation stacking with two columns, moved preferences alongside the brand, and made catch-up dates expandable without shrinking supporting text.
- Updated obsolete test copy and ambiguous selectors to the new labels and explicit control roles.
- Expanded profile-editor reflow exposed native file-input overflow at 320/390px. Constrained form controls; targeted profile checks passed afterward.
- Final production build: pass.
- Final production-mode browser suite: 99/99 pass at 320px, 390px, and desktop. Includes 40px text reflow (twice the default), saved-record reloads without a front/catch-up, recipient selection, todo completion separation, failure recovery, profile form isolation, and expanded profile editor reflow.
- Unit suite: 29 pass, 3 database integration tests skipped because no test database was supplied.
- ESLint, application TypeScript, browser-test TypeScript, and git diff whitespace check: pass.
- Rendered catch-up screenshots were inspected at phone and desktop sizes. All browser data was synthetic and isolated through the test harness.

## Limits

Changes are local and layered onto the already-dirty checkout. No claim is made about deployment, authenticated production records, or PostgreSQL integration acceptance. History remains the current catch-up's recorded window rather than a complete historical browser. Demo storage is in-memory, not durable across server restarts.

Verdict: keep. The local implementation meets the batch's verifiable criteria; production deployment and personal usability acceptance remain separate.

## PR integration checkpoint

Rebuilt the repair in a separate worktree from current main (2e60d41), preserving the newer merged conversation catch-up handoff. The profile controls require the previously unmerged profile-picture column, index, service methods, and web route; these minimal dependencies are included. Auth, plugin installation, and unrelated local edits remain in the original checkout.

A fresh temporary PostgreSQL instance applied baseline plus migrations 0001–0004. Profile-picture backfill, isolation, concurrency, and lifecycle integration checks ran rather than being skipped. A read-only check of the configured database found the picture column and unique index already present; no configured database schema or records were changed.

Added GitHub CI for migrations, unit/database tests, lint, TypeScript, production build, and the browser suite. Independent source review identified lineup pagination and MCP error-result handling; both were resolved with regressions for multiple pages and both widget tool transports.

Final pre-PR isolated checks: 39/39 unit and database integration tests (zero skipped), 99/99 browser checks, production build, lint, and both TypeScript checks pass. The original workspace is unchanged by PR preparation.
