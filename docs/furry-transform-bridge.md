# DIDdy to Furry Image Studio bridge

1. The user explicitly names the alter and attaches a real snapshot.
2. Use `set_alter_appearance` to save that alter's selected private reference photos and optional appearance notes. This is separate from the profile picture.
3. Use `prepare_furry_transform` with the exact name. It returns benign alter context in structured content and sends short-lived reference URLs only in metadata.
4. A host adapter must attach the snapshot as the edit target and the metadata references as `character_reference` inputs to Furry Image Studio's existing `transform-person-to-character` workflow. It must preserve the snapshot's pose, clothing, setting, and scene interactions.
5. If the host cannot consume the metadata as editor attachments, report `HOST_ADAPTER_REQUIRED`; do not call a metadata-only preparation a completed transformation.
6. Only after the user chooses a keeper, use the existing private upload handoff to save it to that alter's gallery. Profile-picture promotion is an explicit later action. This flow never reads or changes hosting/fronting.

## Current exact tool workflow

1. Call `list_alters` to resolve the named alter and retain its `id` and `version`.
2. Call `render_alter_lineup` or open the authenticated gallery so the user can visually choose private photos. Do not choose based on filenames or counts.
3. Call `set_alter_appearance` with that alter ID, the selected image IDs, optional notes, version, and a fresh request ID. It is retry-safe and changes neither the profile picture nor presence.
4. Call `prepare_furry_transform` only after the user has attached the snapshot and explicitly named the alter.

The current Codex host exposes a secure widget-media path but no supported inverse API that turns DIDdy metadata into assistant image-editor attachments. The bridge therefore records and prepares the secure handoff, with runtime image attachment blocked on that host capability.

For a Codex-local host that can call the newly deployed MCP tool programmatically and retain `_meta`, use `withFurryTransformReferences()` from `src/server/furry-transform-entrypoint.ts`: pass `_meta.referenceMedia` directly, invoke `image_gen` inside its callback with `referenced_image_paths`, then let the wrapper remove the 0700/0600 temporary files. Never pass the metadata URLs through a prompt or shell command. A user-selected keeper still returns through the existing private upload handoff; it remains unpromoted until the user separately chooses profile-picture promotion.
