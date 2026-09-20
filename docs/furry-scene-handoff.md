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

## Atomic boundary

Bunch does not require Furry Image Studio for this flow. `prepare_furry_scene`
is private prompt-and-reference preparation only; image generation should be
handled by the host's own AI harness or by Bunch-native `generate_scene`.

Keep private metadata (`_meta.referenceMedia`) out of model-visible prompts,
logs, and command arguments, and do not claim an image was generated from a
preparation-only result.
