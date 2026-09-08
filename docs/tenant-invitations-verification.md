# Tenant invitations — implementation and verification

## Current best

The migration-pinned legacy owner or an authenticated Bunch operator can open invitations from **Account & privacy** by recording current capacity/recovery evidence for three or four systems. Once open, they can create, copy, list, and revoke one-use tenant invitation links. A recipient authenticates with Google, enters a display name, accepts the privacy notice, and redeems the link once into an isolated account.

The link token is 32 random bytes encoded as 43 URL-safe characters. It is held only as a SHA-256 hash in Postgres and carried in the browser URL fragment, so opening the link neither sends nor redeems the token. It is retained in session storage only long enough to survive the login return.

## Legacy-owner bootstrap

The configured external database currently has one account that owns durable private records and no `OPERATOR` account. Migration `0012_tenant_invitations.sql` pins that existing immutable Auth0 owner ID into `invitation_operator` exactly once. This is a migration-time record-ownership check, not an email match and not a runtime "first account" rule. A later or unrelated account cannot self-promote through this path.

## Checks run

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Migration applies | Fresh disposable local PostgreSQL 16 with baseline plus all migrations; `0012_tenant_invitations.sql` recorded | Pass |
| One-use, expiry/revocation, retry, concurrency, isolation, non-owner denial | `src/server/pilot.integration.test.ts` against that disposable database: 9 passed, 0 skipped | Pass |
| Build and static checks | Typecheck, browser typecheck, ESLint, production build, whitespace check | Pass |
| Human browser path | Playwright desktop and real local API/database: Home → Account → record evidence/open → create/copy; separate recipient context → redeem; third context → reuse rejected; direct database assertions after each | Pass |
| Actual external owner role | Read-only aggregate query found one durable-record owner and zero `OPERATOR` rows | Not yet operator-enrolled; migration will pin the existing subject |
| Actual invitation activation | Account form requires a date within seven days, capacity/recovery notes, two explicit attestations, and three/four-slot selection; server atomically promotes only the migration-pinned owner and opens the policy | Source/local-E2E pass; production action pending review |

## Screenshots

- `/private/var/folders/7z/4swhcgxj19gd2m0frf2n0g_r0000gn/T/system-mobile-tests/tenant-invitations.real--e-9a262-s-once-and-isolates-tenants-desktop/real-operator-invitations.png`
- `/private/var/folders/7z/4swhcgxj19gd2m0frf2n0g_r0000gn/T/system-mobile-tests/tenant-invitations.real--e-9a262-s-once-and-isolates-tenants-desktop/real-recipient-accepted.png`

The real browser test uses local Next routes and a disposable PostgreSQL database. It mocks only the external Auth0 session with a per-request synthetic subject, through a test-server flag that is rejected in production builds. The test proves visible controls, policy activation, API requests, copied-link handling, three separate browser contexts, reuse rejection, and durable database state. It does not prove authenticated production interaction, production migration application, or deployment.
