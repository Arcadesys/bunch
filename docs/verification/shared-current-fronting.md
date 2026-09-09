# Shared current fronting — 2026-09-09

Win condition: an owner explicitly enables recorded current fronting on an existing portfolio link, and visitors see overlapping recorded people without expanded portfolio access.

Scope: one implementation and targeted verification pass. Kept baseline: per-link opt-in, default false; stable existing bearer URL; existing eligibility, expiry and revocation checks.

## Behavior

From Home, choose **Share photo gallery**, create a **Forever** link if needed, copy it, and choose **Share current fronting on this link**. Existing links can be enabled or disabled in place; their original tokens cannot be recovered after reloading, as before.

Visitors see **Currently recorded as fronting** before entering the photo gallery. Only active explicit FRONTING periods whose people are in the authorized portfolio are projected into names and IDs. HOSTING and legacy front records are not used. No episode IDs, start times, history, guidance, notes or other private profile fields are added. The existing gallery already shares all owner profiles, including retained archived profiles; this change preserves that boundary.

An empty list says records are unavailable, not that nobody is fronting. The page checks every 30 seconds, on window focus and on manual refresh. Failed reads clear previously displayed content. Browser background throttling can delay automatic checks; the last checked time and manual refresh remain visible. Changing the setting leaves the URL intact.

## Verification

- PASS: migration 0014 applied to a disposable local PostgreSQL database after the repository baseline and earlier migrations; no production database touched.
- PASS: targeted database and unit checks (4): default-off, per-link enable/disable, overlap/end changes, host exclusion, owner isolation, narrow fields, account restrictions, expiry and revocation.
- PASS: full local `test:ci`: 114 tests, zero failures/skips.
- PASS: lint, application and browser TypeScript checks, production build.
- PASS: 24 Playwright checks across 320px, 390px and desktop. Browser API fixtures exercise normal Home → Account navigation, keyboard opt-in, setting persistence, visitor changes, no-record wording, automatic opt-out refresh, unavailable-content clearing, copy/revoke regressions and enlarged-text reflow.
- PASS: saved desktop visitor and phone owner renders inspected for readable hierarchy and high contrast. Browser fixtures and database tests are separate evidence layers, not an authenticated production acceptance claim.

Initial test setup needed the repository baseline before migrations and local dependencies instead of a Turbopack-incompatible external symlink. A fixture attempted two operator accounts despite the unique operator constraint; corrected to one operator and a legacy second owner, with explicit fixture cleanup. Final checks above passed.

## Release status

Implementation is ready for review. Not merged or deployed. Apply `drizzle/0014_shared_current_fronting.sql` before deploying the application; it keeps every pre-existing share opted out. No live share was enabled and no Discord message was posted.
