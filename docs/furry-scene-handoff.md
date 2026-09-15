# Private Furry scenes

`prepare_furry_scene` prepares a fresh scene for explicitly named people. It
resolves exact active names or aliases within the authenticated owner, follows
every profile page, and preserves the requested order. Repeated names identifying
the same person resolve once; unknown or ambiguous names fail.

```json
{
  "alterNames": ["First Person", "Second Person"],
  "scene": "The two friends cooking together."
}
```

Every participant needs at least one selected appearance image. All selected
images are included, with up to twelve images across the whole scene. Requests
exceeding that limit fail instead of silently dropping references. Profile pictures
and unselected gallery images do not substitute for selected appearance images.

The public structured result contains the canonical prompt and identities,
including each person's ordered `referenceImageIds`. Saved appearance notes may
inform the visual prompt; general biographies and system notes do not. Explicit
canonical identity and preservation instructions remain authoritative.

Private capabilities stay exclusively in `_meta.referenceMedia`. Each entry is
associated with its alter ID, name, and selected image ID. `ready` means preparation
succeeded; it does not mean an image was generated or saved.

## Host handoff

Use the scene-capable Furry Image Studio bridge. Keep the complete tool result in
programmatic memory and send it to `materialize-scene` through a no-echo stdin
handoff. Never print the private metadata or place capability URLs in prompts,
command arguments, or logs.

The bridge validates the full identity/reference mapping before downloading.
Inspect the resulting local references and attach every one to generation with
the canonical prompt and its character mapping. Record any required evaluation
before cleanup, and remove temporary references in a finally path. A programmatic
host may use `generatePreparedFurryScene({ toolResult, generateScene })` instead;
its callback receives only the canonical prompt and mapped local reference files.

If the scene tool, programmatic metadata access, or attachment support is absent,
report that limitation. Do not replace the requested people with generic characters.

## Verification

The cross-repository check uses two synthetic profiles with three selected images,
a local HTTP server validating image capabilities, and the real MCP tool transport:

```sh
node --import tsx scripts/verify-furry-scene-handoff.ts /path/to/furry-image-studio/plugins/furry-image-studio/scripts/diddy-bridge.mjs
```

It checks pagination, aliases, all reference associations, downloaded bytes,
permissions, model-input privacy, and cleanup on success and callback failure.
The callback copies a fixture file; this is an attachment test, not image-model
or character-fidelity evidence. No private profiles are used.

Release checkpoints are separate: server merge/deployment, fresh connector tool
discovery, scene-capable plugin installation, and real generation with visual
confirmation. Track the final runtime acceptance in the linked feature issue.
