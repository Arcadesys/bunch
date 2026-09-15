# Canonical visual identity

Profiles store `species`, `visualDescription`, `presentation`, `signatureTraits`,
`styleTags`, and `imageDoNotChange`. Pronouns reuse the existing field. Text is
optional; lists default to empty. PATCH omission preserves values, null clears
text, and an empty array clears a list. Species accepts self-described hybrids.
Visual description is limited to 1,000 characters; other text and list entries
use the existing 500-character limit, with at most 100 entries per list.

The Profiles editor saves through the versioned alter REST API using
`Idempotency-Key`. It retains identical request IDs after uncertain saves and
preserves form entries on failure. Its expected version is captured when editing
opens. Legacy reads expose the new fields; legacy saves preserve omitted values.

## Prompt preparation

Call the read-only MCP tool `prepare_alter_image_prompt` with:

```json
{"scene":"A moonlit group portrait", "alters":"all"}
```

For selected people, pass an array of alter UUIDs instead of `"all"`. All resolves
every page of the owner's non-archived profiles. Explicit IDs are deduplicated
in order; inaccessible or archived IDs fail rather than disappearing silently.
Profile cursors retain PostgreSQL timestamp precision so page boundaries cannot
skip people created within the same millisecond.

The result contains `ready`, `status`, `prompt`, `identities`, and `notices`.
Identity blocks include source profile versions and `referenceImageIds`.
Canonical identity and preservation instructions override conflicting scene text,
style suggestions, and reference details. General biographies and private notes
do not enter the prompt.

Species plus visual description is sufficient text identity. Missing either
requires selected appearance references; a profile picture or unselected gallery
image alone does not qualify. When references fill a gap, `reliesOnReference`
is true and missing fields remain explicit. Otherwise the complete group returns
`NEEDS_INFORMATION`. An empty lineup is also not ready. Unavailable selected
reference images cause preparation to fail instead of silently dropping them.

References travel through `_meta.referenceMedia`, with alter and image IDs
associating each capability with its person. URLs and storage keys never enter
prompt text. The host must attach this media to its generator. Bunch does not
invoke a generator. The existing name-based `prepare_furry_transform` uses the
same builder, retains its snapshot/host-adapter handoff fields, and continues
requiring independently selected appearance references.

## Verification and release

This branch ports the implementation onto main at c2216d7, preserving newer
sharing, episode reviews, independent appearance editing, and navigation.
It adds migration 0012, with nullable text and empty-default arrays only.
No private identity backfill is included.

Local checks on the port: 105 unit/database tests without skips; 207 browser
checks on the production build across 320px, 390px and desktop; lint, type checks,
build, and portable plugin packaging. Tests include a 102-profile pagination
boundary, Twi's supplied hare identity, conflicting scene/style requests,
reference fallback, private metadata, retained drafts and retry behavior.
Mobile CSS keeps recent-change links at least 44px tall and enlarged-text buttons
inside their containers. The existing progressive disclosure is preserved.

Apply migration 0012 to the intended database before merging/deploying code that
reads the new columns. Confirm deployed endpoint readiness separately from
authenticated profile editing and generated-image fidelity; the latter still
needs visual review in the consuming image workflow.
