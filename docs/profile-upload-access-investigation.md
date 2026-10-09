# Profile picture upload: investigation and Luna work plan

## Contract and checkpoint

- Outcome: investigation and approved follow-up implementation complete with Luna workers. Actionable upload errors, safe profile-picture retries, and profile-scoped saved/refresh-pending recovery are implemented.
- Scope: implementation and reviewable draft PR authorized after design. No production-user records changed; no merge or production deployment.
- Route: coordinator review with two explicitly requested Luna workers, both at medium effort: access diagnosis and upload UX design. Cross-component access, storage, and UI behavior justify separate bounded inspections.
- Source baseline: fetched `origin/main`, commit `8a06a0b671a2698cb4df2e5443ad595c55f03030`, on September 27, 2026. The working branch is older and contains unrelated edits; implementation must start from the current main in a suitable isolated checkout.
- Evidence: screenshot, current source and regression changes, GitHub PR/check status, and Vercel deployment inspection.
- Review complete: both Luna workers returned source-backed findings. Coordinator retained the backward-compatible top-level `code` design and medium effort because retry behavior crosses client, storage, and receipt handling. No provider usage/cost counters were available.
- Current blocker to attributing this specific report: screenshot time and a post-deployment authenticated retry are unknown. A visible profile list does not establish current account authorization.
- Final checkpoint: [draft PR #108](https://github.com/Arcadesys/bunch/pull/108), commit `9499d14e2a48637804c32bbb0a791045df994e38`, in `/Users/arcades/.codex/worktrees/profile-upload-retry/system-arcades-me`. GitHub verification and Vercel preview passed. Remote CI: 233 source/database tests and 382 browser tests passed; five optional browser skips. Lint/types/build/recovery/package checks passed. Rendered desktop and 320px/200% text recovery checks passed. Managed worktree is clean; local test database stopped. Remaining: user review and separately authorized merge/release; authenticated production-user retry is still unverified.

## Verified diagnosis

The screenshot shows the Pictures tab rejecting a profile-picture upload with “This account does not have active Bunch access. Visit /join or /account.” It does not establish why the server rejected that request.

The earlier upload reservation implementation used that same rejection when a FRIEND account's operational readiness evidence exceeded seven days. Account reads could still work while an upload failed. This is a confirmed code defect matching the report, but without the request or its timing it is not proof of the reporter's current account state.

[PR #107](https://github.com/Arcadesys/bunch/pull/107) already fixes that path. Current main separates account access from upload pauses in `src/server/pilot-service.ts:467-487`, and removes readiness expiry from `ImageAllowanceService.storagePreflight` in `src/server/image-allowance.ts`. Readiness still gates new invitations. Revocation, explicit pauses, quotas, rate limits, and owner checks remain in force.

Current verification: PR #107 is merged; its `verify` check passed; the merge commit has a successful Vercel status. Deployment `dpl_HtdC1JJnmtPevAvWZFosBMn8XGjY` is `READY`, targets production, and lists `system.thearcades.me` and `system.arcades.me` as aliases. This establishes release evidence, not a successful upload by the reporting user.

The merged regressions exercise stale readiness with an active account, persisted upload reservation, paused uploads without a new reservation, rejected new invitations, and revoked-account upload denial. No tests were rerun against this older working branch for this design task.

## Fix direction

Keep PR #107 as the backend fix. Do not duplicate it or relax access checks to make the screenshot disappear. If the failure happened after deployment, first reproduce on the deployed version and distinguish missing/inactive membership, the global friend-access switch, an explicit upload pause, quota, and authentication failure using the response and authorized account diagnostics. Never infer one from the displayed name or avatar.

The remaining candidate work is focused error/retry handling and end-to-end coverage. These are follow-up improvements, not prerequisites for the already-deployed readiness fix.

The UI review confirmed that failed requests already retain the chosen file and that a failed profile load does not render a successful empty history. Preserve both behaviors. The actual gap is that a successful POST followed by a failed refresh clears the file but leaves only a load-error notice; distinguish those outcomes and offer a refresh-only action. `413` already represents quota in this application, so do not assume it means invalid file size.

## Luna work packets

Run on a clean checkout based on current main. Read the relevant installed Next.js guides before application edits. Give each worker the baseline SHA, its listed paths, constraints, acceptance checks, and the preceding worker's changed facts. Keep shared-file edits sequential.

1. **L1 — Confirm the reported failure, medium effort.** Paths: `src/server/pilot-service.ts`, `src/server/private-images.ts`, `src/app/api/system/images/route.ts`. Establish report timing and perform an authenticated retry with an authorized test profile. On current main, the exact message can still mean missing policy, missing enrollment when the gate is enabled, a non-active account, or disabled friend access. If reproduced, correlate the specific request with the served deployment and the authorized account's gate decision. Return a sanitized cause and evidence; never export profile contents or session tokens. If the deployed fix succeeds, close the original defect without another backend patch.

2. **L2 — Make upload failures actionable, medium effort; optional follow-up.** Paths: `src/app/api/system/images/route.ts`, `src/app/profile-management.tsx`, `src/app/profiles/profile-detail.tsx`. The upload endpoint currently returns a string `error` and optional details, losing `SystemError.code`; the UI displays the string in an existing live status notice. Preserve the string contract and add an optional safe `code` field. Use codes and HTTP status for actions rather than matching English messages. Distinguish sign-in, account access, paused storage, quota, rate limiting, validation, and conflict. A storage pause must never suggest rejoining. Provide a real Account link for access errors, and retain the selected file on failure (which the current handler already does). Preserve one accessible announcement and associate the upload error with the relevant form. Do not disable retries permanently based on a cached error.

3. **L3 — Cover picture persistence and retry boundaries, medium effort.** Paths: `tests/mobile/profiles.spec.ts`, appropriate existing server integration tests, and the upload handler only if a regression proves a needed change. Test both profile-picture replacement and ordinary gallery upload. Current profile-picture submissions generate a new request ID on every submit (`profile-management.tsx:190-197`); before adding a Retry action, verify ambiguous network failure and receipt replay. For unchanged profile-picture attempts, preserve the request ID and original expected version; changing the file, target, or operation starts a new attempt. Clear the attempt only after a known outcome or explicit replacement. Test the full route: it currently saves/reserves storage before checking the mutation receipt, so a stable client ID alone cannot prove replay succeeds at the quota boundary. If that fails, design an owner-scoped receipt preflight before storage with the existing payload-integrity checks preserved. Do not claim ordinary gallery uploads are idempotent: that path currently attaches directly and needs a separate design if automatic replay is proposed. No automatic upload retries are part of this plan.

4. **L4 — Focused verification and review, medium effort, after any edits.** Use synthetic owners and isolated test storage. Run the focused upload/access regressions, rendered browser checks, then required repository CI checks once for the integrated change. Coordinator reviews worker evidence and only repeats a check for a changed input, failure, or unresolved concern. A production user retry is a separate acceptance gate from fixtures or deployment readiness.

## Acceptance

| Scenario | Required result |
| --- | --- |
| Active FRIEND, stale capacity/recovery evidence | Upload and attachment succeed; fresh authenticated read and page reload show the chosen picture and retained previous picture. |
| Same stale evidence, new invitation | Invitation remains blocked. |
| Explicit upload pause | No new storage reservation/attachment; message says uploads are paused and does not claim inactive membership. |
| Revoked, missing enrollment with gate enabled, or friends disabled | Access remains blocked; no upload side effect. |
| Quota or rate limit | Correct reason and recovery action; no false success or duplicate attachment. |
| Different owner's target/image | Request denied; no cross-owner attachment or disclosure. |
| Request fails before commit | File remains selected; retry is possible. |
| Profile-picture commit succeeds but response is lost | Same logical attempt returns its receipt; no duplicate attachment; reload reconciles saved state. |
| Upload succeeds but refresh fails | State is described as saved but refresh unverified; do not invite a second upload as if nothing saved. |
| Rendered error on phone/desktop and enlarged text | Clear large text, high contrast, visible keyboard focus, generous targets, wrapped links, no clipped message or colour-only distinction. Error is announced once and associated with the form. |

No new code tests or rendered accessibility checks were run in this investigation-only task. Browser fixtures establish UI behavior; isolated database/storage checks establish persistence; an authorized authenticated production retry establishes the reporting user's outcome. None substitutes for another.

## Follow-up Gallery triage

- Outcome sought: distinguish missing completed results from the separate profile-photo collection shown by the second screenshot.
- Route: two read-only Luna inspections, medium effort, for query and UI/error-state boundaries. No gallery files changed; PR #108 remains separate.
- Evidence: generated-gallery.ts lists only owner-scoped COMPLETE native/group renders with stored images. Uploaded pictures and saved external/Furry results enter private_image and appear under /gallery (Profile photos). The pictured /gallery/generated view excludes that collection. Native/group completion paths update COMPLETE and storage keys together. Ordinary HTTP/network failures show errors rather than confirmed-empty state.
- Limitation: the expected source/result and account are unknown. No query defect or production data loss is established by the screenshot. The user has been asked which category should be visible.
- Next: for uploaded/imported pictures, clarify the generated-gallery label and provide a Profile photos link; for missing completed native/group results, trace the specific authorized result before choosing a fix. Preserve pre-existing unrelated gallery/navigation edits in the primary checkout.
