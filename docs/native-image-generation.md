# Native image generation

Bunch's Images page generates one image from a prompt, with optional named people. Selected people use every saved appearance reference and their canonical visual identity. An uploaded background and Furry Image Studio are not required.

## Configuration and release

- Apply `drizzle/0018_native_scene_render.sql` before deploying the new application.
- Reuse the existing server-only `OPENAI_API_KEY` and private Blob configuration.
- `NATIVE_SCENE_MODEL` optionally selects the image model. The provider supports prompt-only generation and reference-conditioned edits, following the [official Image API guide](https://developers.openai.com/api/docs/guides/image-generation).
- `NATIVE_SCENE_DAILY_LIMIT` bounds native generation attempts per owner per day; the default is 20. Failed attempts also count because a provider call may have been billed. This is an attempt cap, not a guaranteed dollar budget.
- Private scene outputs are independent artifacts. Generating does not change anyone's profile picture, appearance references, hosting or fronting.

## Execution and privacy

The web interface and MCP tools share an owner-scoped database job. A stable request ID returns the same job; reuse with different input conflicts. Workers claim queued jobs atomically. Processing runs through Next.js `after` within a 300-second route budget, with a 210-second provider timeout. Reopening may resume queued work. Running jobs are never automatically repeated; interrupted attempts fail after six minutes and require a new explicit generation action. A lost response may still have incurred provider usage.

For named people, the job freezes profile versions, the canonical prompt and ordered reference associations. Private reference bytes transfer directly from Bunch's server to the configured image provider. They do not enter model-facing tool text. Before attaching the normalized JPEG, the worker rechecks profile versions and erasure. Authenticated image routes serve output with private/no-store headers.

Account export includes owner-authorized downloads for generated images. Account deletion uses the existing Blob reservation ledger; person erasure removes dependent jobs and images. Provider responses and arbitrary error messages are not exposed in job errors.

## Acceptance checkpoint

Win condition: a prompt submitted through Bunch produces a real private image that decodes in the page and reopens with the same saved hash. A named two-person scene additionally preserves every selected reference.

Verification records will distinguish schema/static checks, provider contract tests, PostgreSQL persistence/erasure/replay tests, browser interaction tests, and the real-provider rendered check. Mocked image fixtures are not evidence of real generation or identity fidelity.
