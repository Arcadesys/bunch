# DIDdy friends pilot — implementation and operations

## Current release gate

The feature is implemented for two invited systems, using existing services and one login per system. **Production invitations remain closed.** No cloud plan, production database, OAuth configuration, or spending setting was changed during implementation.

Live billing discovery failed on 2026-09-05: the Vercel connector returned 403 and `vercel usage` returned “Costs not found” (404). PostgreSQL/Auth0/Blob allowances, an existing protected offsite backup destination, and second-account client acceptance have not been verified. Do not interpret local tests or a plugin package as evidence that these gates passed.

## Apply and enroll safely

1. Back up the existing database. Apply additive migration `0008_friends_pilot.sql` before deploying this server revision. Old records and IDs are preserved. The migration creates a policy with membership enforcement off and invitations/friend access/uploads closed, preserving the existing owner's access during rollout.
2. Use the existing operator's exact immutable Auth0 owner ID with `npm run pilot:admin -- enroll-operator OWNER_ID`. This does not create an identity, change a front, or enroll friends. The ID must already exist in `app_user`.
3. Audit any other existing `app_user` rows. Never automatically classify unknown accounts as trusted. `lock-gate` and `open` refuse to proceed while unenrolled existing accounts remain. Run `npm run pilot:admin -- lock-gate` before exposing the new server: it requires the enrolled operator, turns on membership enforcement, and keeps friend access/invitations closed. Do not leave the migration’s temporary compatibility setting enabled on the deployed pilot.
4. Verify baseline spending and allowances for Vercel, PostgreSQL, Auth0, Blob, and the backup destination. Set supported provider alerts/spending controls within current authorized spend. Account for other projects sharing allowances and the monitoring/backup workload. There is no automatic paid upgrade.
5. Establish daily encrypted backups and test recovery as described below, including private media and deletion replay. Store the resulting non-secret evidence file outside this repo.
6. Run `npm run pilot:admin -- open /secure/path/evidence.json` only after those checks pass. This atomically enables membership enforcement, friend access, invitations, and uploads, for at most two systems.

Evidence must match this shape (values must describe actual checks, not estimates):

```json
{
  "checkedAt": "2026-09-05T00:00:00Z",
  "baselineMonthlyUsd": 0,
  "additionalCommittedUsd": 0,
  "capacityWithinExistingAllowances": true,
  "providers": {"vercel": "billing evidence reference", "postgres": "compute/storage evidence", "auth0": "account allowances", "blob": "storage and delivery allowance"},
  "recovery": {"days": 7, "encrypted": true, "restoreTestPassed": true, "restoreReport": "report reference", "deletionReplayTestPassed": true},
  "spendControls": "configured controls and alerts reference",
  "pilotSlots": 2
}
```

The file records operator attestations; the application does not pretend it can verify provider bills. Stale evidence automatically prevents new invitations, invitation acceptance, and friend uploads after seven days. Existing records, exports, and deletion remain available. Recheck capacity and recovery before renewing evidence. Do not expand beyond two during the first week.

## Invitation and client setup

`npm run pilot:admin -- invite friend@example.com` creates a single-use code valid for seven days. Deliver it privately to that friend; it is never sent automatically. They sign in at `/join`, paste the code, choose a system display name, and accept the privacy disclosure. The verified Auth0 email must match; ownership then stays bound to immutable `sub`, not email. No alter or presence record is inferred or seeded.

Revocation: `revoke-invite INVITATION_UUID` invalidates an unused invitation; `revoke OWNER_ID` stops an active friend's access. Revoked friends can still export or delete their own data from `/account`.

The distributable package lives in `plugins/diddy`; `npm run plugin:pack` makes an allowlisted archive outside the repo. It includes no app data, personal plugin IDs, tokens, hook scripts, or local environment files. Install the archive through the recipient's supported Codex plugin controls, then complete their own OAuth sign-in. Do not install from the obsolete personal snapshots.

For ChatGPT, follow `/connect`: eligible accounts add the HTTPS MCP endpoint through custom-app/developer settings and authenticate individually. Workspace policy may require an administrator. A public app-store listing is not part of the pilot. The website is the fallback when custom apps are unavailable.

Verify on a real second account in **both** clients: accept invitation, list only its own profiles, record hosting and an overlapping fronting episode, close/reopen, refresh after token expiry, and read the same owner-scoped records. Do not claim cross-conversation retrieval or summary quality from deterministic MCP tests.

## Data lifecycle and limits

The account APIs are `/api/v1/account`, `/export`, `/delete`, and `/images/:id`; invitation acceptance is `/api/v1/pilot/accept`. They derive identity from the authenticated session. Export is JSON plus authenticated downloads of every original image. Download the images too for a complete export; links require the account session and do not expose storage keys. Account deletion requires `DELETE MY SYSTEM`. Per-image deletion has a separate confirmation.

Membership gates protect normal web and MCP requests and widget image/upload capabilities. Database triggers serialize write access against membership changes. The operator remains accessible when friend access is paused. A leaked bearer image capability can authorize its one image until expiration; it is not a general account credential. Capability URLs must remain widget-only and be redacted from provider logs.

Friends receive a 50 MiB total image quota and the existing 5 MiB file limit. Committed upload reservations count toward the quota before transfer. Limits are 60 web requests/minute, 60 MCP requests/minute, 120 image requests/minute, and 10 uploads/minute per enrolled friend. They are protective limits, not a guaranteed dollar ceiling. Provider-level controls remain necessary for unauthenticated traffic and delayed usage billing.

Deletion first changes access to DELETING. It waits for pending uploads, removes blobs, then removes owner records in dependency order. A storage failure leaves access stopped and deletion retryable. A minimal owner/state tombstone remains to prevent accidental reactivation. Backups may retain encrypted copies until their seven-day expiry; they must not reactivate deleted accounts after restore.

Run `reconcile-uploads` to clean abandoned reservations older than one hour, then `retry-deletions` for pending deletions. Configure the upload function's maximum execution duration below one hour. A failed cleanup retains its ledger entry for retry rather than silently losing track of a private file. Schedule these maintenance commands on the existing operations runner; do not create a paid service.

## Recovery and operating budget

`npm run pilot:backup -- create` uses `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`, `PILOT_BACKUP_KEY` (32 random bytes encoded as 64 hex characters), and `PILOT_BACKUP_DIR` (an existing protected offsite destination outside the checkout).

It captures a consistent PostgreSQL snapshot and all referenced private media, computes hashes, encrypts the archive with AES-256-GCM, and deletes temporary plaintext files. Incomplete media downloads fail the backup. Successful runs prune this tool's archives older than seven days. The existing backup runner must run `npm run pilot:backup -- prune` daily even when backup creation fails; do not rely solely on successful runs for retention. Keep the key separate from the destination and verify its recovery path.

`npm run pilot:backup -- verify FILE` requires a separate empty `pilot_restore_*` PostgreSQL database in `PILOT_RESTORE_DATABASE_URL`. It authenticates the archive, checks database/media hashes, restores only to that isolated target, replays current non-active account states from the live database, and leaves all friend access closed. It never overwrites production or publishes restored media. Dispose of the verification database and report safely after checking it.

A live disaster restore is intentionally an operator procedure: keep access closed, reconcile the latest deletion/revocation journal from surviving live state or the independently protected operations record, purge deleted owners and their media, re-upload only retained media, verify isolation, and then reopen. If current deletion history cannot be recovered, do not reopen restored accounts. Configure seven-day object/version retention on the backup destination as well as the local runner.

Observe existing-provider usage daily for the first week. At 80% of a shared allowance or any forecast above baseline spending, run `freeze` (closes invitations and friend uploads). If access itself cannot fit, run `pause` (stops friend access while preserving operator access and friend export/deletion). Both are reversible without deleting user records. Never expand, upgrade, or silently disable backups to make the numbers fit.

## Verification log

- Database scenarios: verified invitation binding/retries/capacity, cross-owner read/write/export denial, atomic quota races, rate limiting, revocation/write guards, retryable deletion, and operator-preserving pause.
- Browser: synthetic account acceptance, failed-invitation draft retention, large-text reflow, original-image export links, exact deletion confirmation/retry, signed-out fallback, and client instructions.
- Local recovery rehearsal: encrypted database archive restored into an empty disposable database; altered ciphertext rejected, post-backup revocation replayed, and seven-day pruning verified. This fixture had no private media and does not certify production media recovery or seven days of operated backups.
- Browser plugin not available; used repository Playwright with production build. Phone screenshot inspected for readable hierarchy and contrast.
- Live billing, production backup/restore, OAuth expiry on another real account, client installation, and the one-week pilot remain explicit launch gates.

Final local score: 69 server checks, 120 browser checks, lint, application/browser typechecks, production build, plugin validation, and the isolated recovery rehearsal passed. No production activation or invitations have occurred.
