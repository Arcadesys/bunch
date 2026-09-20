# Native image generation

Bunch's Images page generates one image from a prompt, with optional named people. Selected people use every saved appearance reference and their canonical visual identity. An uploaded background and Furry Image Studio are not required.

For a one-shot named-character request such as “@Bunch draw Lucy in a cozy
sweater,” resolve the exact active name `Lucy Arcade` (or a confirmed exact
alias), then call `generate_scene` with that name in `alterNames`. Bunch supplies
the selected appearance references privately to its native provider; the user
does not need to upload a source photo.

When the user explicitly asks ChatGPT to generate an image using an uploaded
scene, object, or style image and names one or more alters, route to
`prepare_chatgpt_alter_image`. Resolve every alter by exact active name or
confirmed exact alias before preparing the handoff. The uploaded image is image
1; the ordered private appearance-reference images follow it. The widget
transfers reference bytes to transient ChatGPT files with `library: false`,
keeps the Bunch capabilities widget-only, and asks ChatGPT's image tool to
generate with the resulting transient file IDs. Reference bytes are necessary for identity fidelity;
reference IDs, prose, URLs, and storage identifiers are not image content.

If an alter is unknown, ambiguous, archived, or has no selected appearance
reference, stop visibly and name the exact missing or conflicting identity.
Never silently omit a participant, invent a likeness, or fall back to a prose
description. If the ChatGPT file, upload, or generation handoff fails, stop
without claiming an image was generated.

The ChatGPT handoff is distinct from native Bunch generation. Its generated
output remains a private generated image and does not change profile pictures,
appearance references, hosting, fronting, presence, or canon. A generated
output is never automatically a profile picture, selected reference, or canon.

Reference IDs returned by `get_alter` and the `prepare_*` tools identify photos
but carry no pixels. Capabilities, URLs, bytes, and storage keys remain private
metadata and never enter model-visible content.

Tool descriptions and server instructions reach ChatGPT only after a deploy and
a refresh of the connector's tool list; a stale connector keeps the old wording.

## In-chat result

`generate_scene` and `get_scene_generation` render the Bunch scene widget
(`ui://system-arcades-me.vercel.app/native-scene-v1.html`). While a job is queued
or running, the widget calls `get_scene_generation` from the chat every five
seconds, for up to about seven minutes, then shows the finished image.

The image loads from `/api/system/native-scenes/inline/{renderId}` with a
five-minute capability scoped to one owner and one render. It is issued only for
a complete job and returned in `_meta.sceneImage`, which hosts pass to the widget
and not to the model. Tool text and structured content carry only the job and the
authenticated `/images` link, which remains the fallback for hosts that cannot
render widgets. If the capability expires while the card is open, the widget
requests one fresh capability before pointing to that link.

## Configuration and release

- Apply all migrations through `drizzle/0023_ai_spend_ledger.sql` before deploying. This preserves the attempt backfill and adds versioned cost metadata without storing prompts or private-media identifiers.
- Reuse the existing server-only `OPENAI_API_KEY` and private Blob configuration.
- `AI_COST_ROUTING_STAGE` controls rollout: `shadow` (default) records the current Sunburst/high path, `operator` enables routing and dollar gates only for the operator, `pilot` enables them for all pilot accounts, and `off` restores the configured legacy Sunburst/high route while retaining telemetry, the count allowance, and the hard daily spend pause. `NATIVE_SCENE_MODEL` and `GROUP_PHOTO_MODEL` remain legacy/off-route overrides.
- Active routing uses GPT Image 2 medium for prompt-only scenes, Sunburst high for reference-sensitive generation/repair/photo finishing, and GPT Image 2 low after the $0.10 daily soft limit. At $0.25, paid images pause until Chicago midnight. The existing 10-use FRIEND limit remains independent.
- Every active FRIEND account has **10 shared image uses per Chicago calendar day**. `NATIVE_SCENE_DAILY_LIMIT` now controls the OPERATOR/legacy default only (20). Account → Pilot image allowances lets the active operator override any account with 0–1000 uses or clear the override. Zero blocks new requests.
- Native generation, repairs and Group Photo finishing share `image_usage`. Admission and job creation run under the owner row lock. Replays do not reserve again. The admission day stays fixed across midnight, regardless of worker start time.
- Reservations reduce remaining uses immediately. Only failures before dispatch release them; provider failures, uncertain timeouts and storage failures after dispatch count. Deleting outputs never refunds dispatched uses. Expiry never retries a provider call.
- `GET /api/v1/image-allowance` returns the count allowance, current dollar spend, routing stage/mode, limits, reset time, and next prompt-only/identity-sensitive routes. Native/group responses and MCP expose the same accounting. Resets are midnight America/Chicago, including daylight-saving changes; UI shows the local equivalent.
- The ledger stores model, quality, size, action, route, reference count, versioned price basis, modality-specific token usage, and estimated/confirmed microdollar cost. It never stores prompts, reference IDs, provider messages, or private image bytes. Provider-confirmed usage replaces the conservative dispatch estimate when the response contains a complete modality breakdown.
- Private scene outputs are independent artifacts. Generating does not change anyone's profile picture, appearance references, hosting or fronting.

## Execution and privacy

The web interface and MCP tools share an owner-scoped database job. A stable request ID returns the same job; reuse with different input conflicts. Workers claim queued jobs atomically. Processing runs through Next.js `after` within a 300-second route budget, with a 210-second provider timeout. Reopening may resume queued work. Running jobs are never automatically repeated; interrupted attempts fail after six minutes and require a new explicit generation action. A lost response may still have incurred provider usage.

For named people, the job freezes profile versions, the canonical prompt and ordered reference associations. Private reference bytes transfer directly from Bunch's server to the configured image provider. They do not enter model-facing tool text. Before attaching the normalized JPEG, the worker rechecks profile versions and erasure. Authenticated image routes serve output with private/no-store headers.

Account export includes owner-authorized downloads for generated images. Account deletion uses the existing Blob reservation ledger; person erasure removes dependent jobs and images. Provider responses and arbitrary error messages are not exposed in job errors.

## Acceptance checkpoint

Win condition: a prompt submitted through Bunch produces a real private image that decodes in the page and reopens with the same saved hash. A named two-person scene additionally preserves every selected reference.

Verification records will distinguish schema/static checks, provider contract tests, PostgreSQL persistence/erasure/replay tests, browser interaction tests, and the real-provider rendered check. Mocked image fixtures are not evidence of real generation or identity fidelity.

## Repairs

Use **Repair this image** from image history, either gallery, or a finished Group Photo. The Images page also lists available private sources. A correction makes a separate native image job using `repairSource: { kind: "private" | "native" | "group", id }` and the existing `scene` field. Repair jobs reject additional named people, retain source orientation at supported provider sizes, and preserve the original. The MCP `repair_image` tool accepts `source`, `correction`, and a stable `requestId`; `get_image_allowance` reports the shared balance.

Repair jobs snapshot all ancestor person dependencies and link to their immediate source with cascading foreign keys. Source ownership and existence, profile versions, and active account access are checked before dispatch and attachment. Person erasure includes repair descendants. Private-source deletion removes descendant bytes and jobs; account export/deletion includes repairs and usage. The existing `pilot:admin reconcile-uploads` command also removes orphaned generated outputs while preserving attached generations, group photos, and backgrounds.

Storage is separate from daily uses. Before dispatch, the service requires the existing storage policy and at least 5 MB of remaining storage for a pilot account, matching the maximum normalized output. Concurrent uploads can still consume this headroom; upload reservation remains authoritative.

For rollout, run the database and browser checks, apply migrations, deploy, then perform one authenticated real generation and one repair. Verify both images decode and their saved hashes survive reopening. A configured key, successful build, or synthetic fixture alone does not establish provider access or live image quality.
