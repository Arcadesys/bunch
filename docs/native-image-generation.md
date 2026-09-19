# Native image generation

Bunch's Images page generates one image from a prompt, with optional named people. Selected people use every saved appearance reference and their canonical visual identity. An uploaded background and Furry Image Studio are not required.

For a one-shot named-character request such as “@Bunch draw Lucy in a cozy
sweater,” the companion should resolve the exact active name `Lucy Arcade` (or
a confirmed exact alias), then call `generate_scene` with that name in
`alterNames`. Bunch supplies the selected appearance references privately to
the native provider; the user does not need to upload a source photo. The
result remains a private generated image and does not change Lucy's profile
picture, appearance references, hosting, fronting, or canon.

Reference IDs returned by `get_alter` and the `prepare_*` tools identify photos
but carry no pixels, and reference media stays in private metadata that a chat
host's own image tool never receives. `generate_scene` is therefore the direct
route for drawing named people in chat, not a fallback after a prepare tool. The
prepare tools build packets for external image-studio adapters only.

ChatGPT once called `prepare_alter_image_prompt` for Lucy, read its prompt
("Use the attached appearance reference…"), found no attachment, and asked the
user to upload one. The tool descriptions, server instructions, and companion
skill now send drawing requests straight to `generate_scene`. Because hosts act
on results more reliably than descriptions, the result text of `get_alter` and
`list_alters` names the exact `generate_scene` call, and the prepare results
lead with it, ahead of the packet, whenever every named person is ready and has
selected appearance references.

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

- Apply all migrations through `drizzle/0022_image_allowance_repairs.sql` before deploying. This backfills today’s existing native/group jobs as spent uses and queued jobs as reservations.
- Reuse the existing server-only `OPENAI_API_KEY` and private Blob configuration.
- `NATIVE_SCENE_MODEL` optionally selects the image model. The provider supports prompt-only generation and reference-conditioned edits, following the [official Image API guide](https://developers.openai.com/api/docs/guides/image-generation).
- Every active FRIEND account has **10 shared image uses per Chicago calendar day**. `NATIVE_SCENE_DAILY_LIMIT` now controls the OPERATOR/legacy default only (20). Account → Pilot image allowances lets the active operator override any account with 0–1000 uses or clear the override. Zero blocks new requests.
- Native generation, repairs and Group Photo finishing share `image_usage`. Admission and job creation run under the owner row lock. Replays do not reserve again. The admission day stays fixed across midnight, regardless of worker start time.
- Reservations reduce remaining uses immediately. Only failures before dispatch release them; provider failures, uncertain timeouts and storage failures after dispatch count. Deleting outputs never refunds dispatched uses. Expiry never retries a provider call.
- `GET /api/v1/image-allowance` returns `limit`, `used`, `reserved`, `remaining`, `resetsAt`. Native/group responses and MCP expose the same accounting. Resets are midnight America/Chicago, including daylight-saving changes; UI shows the local equivalent.
- This is an attempt cap, not a dollar budget. Numeric provider token usage is saved when returned, without provider messages or private image bytes.
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
