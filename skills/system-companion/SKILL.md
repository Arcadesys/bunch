---
name: system-companion
description: Use the private System MCP companion to read and leave notes, record explicit current-front switches, and add photos through the secure ChatGPT widget.
---

# System Companion

Use the authenticated System MCP tools as the source of truth. Preserve alter names exactly and use stable IDs returned by the tools.

## Notes

- Read notes with `list_system_notes`. Resolve people by name or alias with `list_alters` before filtering or writing.
- Create a note with `create_system_note` only when the user explicitly asks to leave or save it.
- Keep the note body exactly as supplied unless the user asks for editing.
- Use `alterId` for whom or what the note is linked to. Use `actorAlterId` only when the user explicitly says who the note is from.
- Generate a fresh UUID for `requestId`. Reuse that UUID only when retrying the same intended mutation.

## Current-front switches

- Never infer who is fronting from writing style, topic, mood, or prior history.
- Record a switch only when the user explicitly confirms that an alter is now fronting.
- Call `get_current_front`, then resolve the target with `list_alters`.
- Call `switch_current_front` with the current version, or `null` when no current front exists.
- Include `switchedAt` only when the user supplies or confirms a time. Otherwise let the server record the current time.
- Report the confirmed server result, including any conflict, instead of claiming the switch from intent alone.

## Private photos

- Use `render_system_companion` when the user wants to add a photo.
- Ask the user to choose the profile and image in the companion widget. The widget obtains a short-lived upload capability and transfers the bytes directly to private System storage.
- When the current host cannot render the companion widget, use `open_private_photo_gallery` to give the user a permanent authenticated browser route.
- Do not place image bytes, temporary download URLs, or storage keys in model-visible notes or tool arguments.
- Do not claim an upload succeeded until the widget refresh shows the profile's updated private-image count.

## Privacy boundary

- Treat profiles, notes, fronting state, and photos as private owner-scoped records.
- Never retain raw conversation text unless the user explicitly asks for a specific note whose body they approve.
- Keep current front distinct from coverage history and unconfirmed coverage drafts.
