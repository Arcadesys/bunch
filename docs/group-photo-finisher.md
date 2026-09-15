# Group Photo finisher

The Group Photo page offers **Finish photo** after placing people. It uses the uploaded scene, saved coordinates and layer order, canonical visual identity, and each person's explicitly selected appearance references. Missing or unavailable references block the attempt with a named correction. Profile pictures are never substituted. Up to 15 selected reference images plus the scene are accepted; larger groups need fewer selected references or a smaller composition.

Finished photos are private JPEGs. The page shows progress, the saved result and a download link. **Recent scenes** reopens both scene placement and saved results through normal navigation. Moving tokens later marks the displayed result as belonging to an earlier scene version. A failed retry preserves the previous successful photo.

## Runtime and configuration

- Apply `drizzle/0015_group_photo_finisher.sql` before deploying this code. It adds render records and access guards; no existing image is modified.
- Configure `OPENAI_API_KEY` through the existing secure deployment-secret process. No key is included in source, browser payloads or logs.
- `GROUP_PHOTO_MODEL` optionally overrides the default `gpt-image-2.5-sunburst`. The adapter uses OpenAI's image-edit API with high quality and JPEG output, passing private image bytes directly rather than publicly sharing references. See the [official image-generation guide](https://developers.openai.com/api/docs/guides/image-generation).
- Existing private Blob storage and account quotas apply to results. The server decodes, checks dimensions and normalizes each result before saving it, then records a SHA-256 hash and dimensions.
- Without a provider credential, the page explicitly says finishing is not connected. Scene arrangement remains available.

## Job and privacy behavior

POST `/api/v1/group-photos/{project}/renders` requires authentication, same-origin protection, an idempotency UUID and the expected scene version. A transaction serializes attempts per owner and permits one active attempt. Reusing a request returns the same render. A worker claims QUEUED exactly once before contacting the provider.

Next.js `after` runs processing within a 300-second route budget; the provider request times out after 210 seconds. A queued job can be picked up when its scene reopens. RUNNING jobs are never automatically retried, since a lost provider response may already be billable. After six minutes an interrupted attempt becomes FAILED on the next status read; retry requires an explicit new user action. This is bounded in-request background execution with durable status, not an unlimited durable queue.

Only owner-authenticated image routes serve result bytes, with private/no-store headers. User account export includes scene/render metadata without storage keys. Account deletion includes the new records and upload reservations. Erasing a person removes jobs and finished photos containing them, and an in-flight worker cannot reattach a photo after erasure or an appearance-version change.

## Verification checkpoint

Win condition: a normal Home → Group Photo → scene upload → placement/Arrange → Finish photo flow performs real generation, saves the output privately, displays a decoded image and reopens it.

Budget: one cohesive implementation, targeted tests, one real-provider acceptance attempt after credentials are available.

Current checks:

- Database integration tests cover retry replay, concurrent worker claims, owner isolation, missing references, stale scene versions, decoding, saved bytes/hash, previous-result retention, interrupted-job handling and erasure during generation.
- Provider HTTP contract tests use a substituted transport and check multipart image inputs and redacted errors.
- Six browser interaction checks pass at 320px, 390px and desktop, including direct placement/Arrange and finisher progress/display/reopening. Their result image is explicitly labeled a UI test fixture; these are not real-generation evidence.
- Application/browser/real-test typechecks, ESLint and a production build pass.
- Initial full-suite run exposed an uninitialized local test database; reran using a dedicated initialized local test database. A missing synthetic erasure-signing fixture was corrected. All 118 then-existing server tests passed; the additional HTTP contract test passed separately.
- Real-provider Playwright launch was attempted and stopped in preflight because no `OPENAI_API_KEY` was configured. No provider request, real generated result, stored real output or rendered real-photo acceptance has passed.

## Real-provider Playwright acceptance

`npm run test:group-photo:real` is a separate, non-mocked suite with retries disabled. It fails clearly rather than skipping if credentials are absent. Set an existing authorized `OPENAI_API_KEY` and `GROUP_PHOTO_TEST_DATABASE_URL` through the local environment or ignored `.env.group-photo-test.local`. The database must be local and its name must end in `_test`; production URLs are rejected.

The suite creates an isolated `group_photo_finish_e2e` schema and synthetic fox/rabbit/cat appearance references. It starts a local-only demo server, walks from Home through normal UI, generates once through the real provider, independently checks saved disk bytes/hash against authenticated image delivery, decodes the displayed image, and reopens it using Recent scenes. It retains the generated image, receipt and screenshot under `test-results/group-photo-real` for visual review. A human/visual check must still judge identity preservation, grouping and natural posing; decoded bytes alone do not prove composition quality.

Do not substitute the UI test screenshot, fixture background or mocked provider tests for this acceptance result. No new provider credential or public sharing is authorized by the implementation.
