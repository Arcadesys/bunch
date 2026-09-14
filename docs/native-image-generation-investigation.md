# Bunch native scene generation: investigation checkpoint

Win condition: identify a concrete first slice that generates a private scene from named people and a prompt, without Furry Image Studio, with implementation requirements and observable acceptance checks.

Scope: one read-only source investigation across three Terra agents, followed by integration of findings. No application implementation, credential changes, deployment, or paid generation was performed.

Baseline: Bunch main `fb4f725` (PR #43 merged), Furry Image Studio PR #10 also merged. Merge is verified separately from deployment and authenticated rendering.

## Recommendation

Build a native scene job alongside Group Photo, sharing the provider and private-image infrastructure. Group Photo already calls the image provider itself. Its required uploaded background and placements are the main product restriction; arbitrary scene generation does not require the Furry Image Studio host bridge.

Keep the existing Group Photo project contract intact. Add scene-owned generation records rather than making background/placement fields nullable or attaching a multi-person result to one person's gallery automatically.

## First slice

1. Accept named people, scene text, and a stable request ID through an authenticated web route and a mutating MCP tool.
2. Resolve exact names and aliases within the owner account. Validate all selected appearance references, preserve their order and person associations, and snapshot canonical visual fields, appearance notes, profile versions, and prompt.
3. Read reference bytes directly on the server. Generate with the references and prompt, without a required background image. Keep capabilities, storage keys and reference image bytes out of model-visible results.
4. Normalize and privately save one output. Recheck profile versions and erasure before committing. Return a job ID and safe status, with an authenticated preview/history route and a chat widget where supported.
5. Reopen the same saved result. Adding it to an alter gallery or promoting it to a profile reference remains a separate explicit action.

## Implementation boundaries

| Area | Existing foundation | Required work |
| --- | --- | --- |
| Scene recipe | `src/server/image-prompt.ts`, `src/domain/image-prompt.ts` | Extract shared resolution/validation without issuing bridge capabilities; preserve canonical identity rules. |
| Jobs | `src/server/group-photo-render-service.ts` | Add a scene-owned table/service with owner-scoped replay, immutable recipe and matching-input conflict checks. Share concurrency limits across generation entry points. |
| Provider | `src/server/group-photo-provider.ts` | Reuse byte input and normalized JPEG output; separate background-dependent prompt/aspect logic; retain safe errors and timeout. |
| Execution | Group Photo REST routes use `after` | Explicitly wire MCP job execution and route duration; expose recovery status without automatically repeating uncertain billable requests. |
| Private outputs | Private Blob helpers and authenticated image routes | Add owner-scoped scene output delivery and history; extend export, account deletion and person erasure. |
| Spending | Existing storage/upload quotas | Add atomic per-owner generation admission limits and usage accounting; storage limits do not bound provider spending. |
| Display | Group Photo polling/reopen UI, MCP private widgets | Add accessible scene prompt/status/preview surface and browser fallback. Keep skill copies synchronized. |

The current Group Photo provider allows 15 selected references plus a background. The scene handoff allows 12 total references. Set one explicit native-scene limit and reject excess references instead of silently dropping them.

Existing background execution has durable database status but runs within a bounded request lifecycle. An external durable queue can be a later improvement if the first slice preserves honest interruption states, safe claims, explicit retries and supported execution budgets.

Integration review corrected one audit finding: existing generated blobs already enter `pilot_upload` through `savePrivateImage` (`src/server/private-images.ts`), so their absence from the deletion query's direct render-table union is not proof of an orphaning bug. New scene outputs must preserve that reservation path and deletion coverage. A confirmed gap is export portability: export includes render metadata but currently builds media download entries only from `private_image`; generated scenes need their own owner-authorized export downloads.

## Acceptance checks

- Two named people with three selected references produce the exact ordered recipe and provider inputs; no uploaded background is required.
- Missing, ambiguous, archived, unavailable-reference or over-limit inputs fail before a provider call.
- Duplicate requests and concurrent workers do not duplicate provider execution; conflicting reuse of a request ID fails.
- Reads and outputs are owner-isolated. Provider errors and model-visible responses expose no private bytes, capabilities or storage keys.
- Profile changes and erasure during generation prevent attachment of stale output and clean uncommitted storage. Account export/deletion cover new records.
- Generation limits are enforced atomically before provider execution, including concurrent web and MCP requests.
- Keyboard navigation, visible focus, readable status and responsive layout work; a rendered private image survives refresh and reopen.
- A separately authorized real-provider check verifies stored output bytes/hash, decoded display and identity preservation. Mocked tests establish contracts, not real generation quality.

Verdict: the architecture investigation passes. Native scene generation is not implemented or live-verified by this pass.
