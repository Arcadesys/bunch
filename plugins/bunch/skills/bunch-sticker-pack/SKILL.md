---
name: bunch-sticker-pack
description: Build a personalized ten-reaction sticker pack for an explicitly selected Bunch person. Use Bunch for the creative contract and private appearance references, ChatGPT for cheap pose blocking and per-sticker repair, and Telegram only after final approval.
---

# Bunch Sticker Pack

## Done state

Create ten useful reaction stickers that feel like one explicitly selected Bunch person, not ten generic emoji poses.

Bunch owns the durable creative contract:

- selected person
- communication profile
- ten semantic reaction slots
- approved acting direction
- final Telegram add-pack URL, when published

ChatGPT owns the visual working session:

- cheap blocking images
- one-sticker-at-a-time repair
- final character render
- final one-sticker-at-a-time repair

Do not use Bunch-native paid image generation for this workflow unless the user separately and explicitly asks for it.

## Never infer the subject

The person whose pack is being built must be explicitly named or selected.

Do not choose the subject from:

- current host
- current fronting
- recent presence
- writing style
- conversation topic
- who was last active

Resolve the requested person with Bunch and keep that stable alter ID for the whole pack.

## Default ten semantic slots

Use these unless the user explicitly changes the pack:

| id | intent | emoji |
| --- | --- | --- |
| yes | Yes / approval | 👍 |
| no | No / rejection | 👎 |
| applause | Praise / applause | 👏 |
| thanks | Thank you | 🙏 |
| sorry | Sorry / oops | 😬 |
| laugh | Laughter | 😂 |
| love | Love / affection | ❤️ |
| confused | Confusion / what? | ❓ |
| congrats | Congratulations | 🎉 |
| bye | Bye / goodnight | 👋 |

These are **meanings, not poses**.

A person might express thanks with ASL, a bow, a tiny nod, a theatrical flourish, a deadpan salute, or something else. Cultural or signed-language accuracy outranks stock sticker conventions.

## 1. Load the person and any existing board

Resolve the exact active person with Bunch, then call `get_sticker_pack` with that person's stable alter ID.

Also inspect the profile's existing `communicationGuidance`, description, visual identity, and whether selected appearance references exist.

Use saved communication guidance as a useful seed, not as proof that the ten performances are already known.

If an approved board already exists, show it and ask whether to continue from it or revise it. Do not silently replace an approved board.

## 2. Personality and communication interview

Talk naturally rather than presenting a long questionnaire.

Learn what changes the acting:

- exuberant vs restrained
- theatrical vs deadpan
- affectionate vs reserved
- physical vs verbal communicator
- formal vs casual
- cultural gestures or etiquette
- signed language
- recurring facial expressions
- signature gestures, props, or phrases
- whether text belongs on stickers
- gestures or portrayals to avoid

The reference image is not needed yet.

When the acting is clear enough, summarize the communication profile in a few bullets and propose all ten performances together.

## 3. Build the ten-row creative contract

Each slot carries:

```text
stickerId
intent
emoji
performance
expression
gesture
framing
intensity
text
visualNotes
```

Show all ten before generating art.

Iterate in conversation until the user says the board is right.

Only after explicit approval call `save_sticker_pack` with:

- the exact alter ID
- a fresh requestId
- expectedVersion from the last read, or null for a new board
- status `APPROVED`
- the communication profile
- all ten approved slots
- telegramUrl null

A draft may be saved earlier only when the user explicitly asks to save the draft.

## 4. Cheap blocking pass

Blocking tests acting, not likeness.

Generate rough pose studies for the ten approved slots using the cheapest useful visual treatment available in ChatGPT:

- loose gesture drawing
- simple mannequin or generic toon body
- plain background
- minimal shading
- no polished costume detail
- no final character markings
- no text unless placement itself needs testing

Do **not** use Bunch appearance references for blocking unless body structure is essential to the performance, such as:

- tail
- wings
- mobility device
- unusual anatomy
- species-specific gesture

Keep every result associated with its stable `stickerId`.

## 5. Review and repair one sticker at a time

Present the blocking set together when the host supports it.

If the user dislikes one sticker, change only that sticker.

Default action: **repair this sticker**

Escape hatch: **regenerate this sticker from scratch**

Preserve the other nine exactly.

A repair request should carry:

- stickerId
- current blocking image
- approved slot direction
- user's correction

Do not restart the full pack because one performance is wrong.

## 6. Final character pass using Bunch references

Once a blocking image is approved, render the real character one sticker at a time.

For each sticker call `prepare_chatgpt_alter_image` with the exact selected alter name.

Use:

- the approved slot performance as the scene
- the approved blocking image as `sceneImage` when the host can pass it
- Bunch's selected private appearance references from the secure handoff

The secure widget transfers Bunch references as transient ChatGPT files. Do not ask the user to upload a reference Bunch already has.

The final prompt should preserve:

- approved pose and acting
- canonical species and body structure
- colors and markings
- hair / fur / feathers / scales
- clothing and accessories
- tail / ear / wing anatomy
- appearance notes
- image-do-not-change constraints
- any established hand/paw rules

The reference character must not rewrite the approved performance.

If the host cannot attach the blocking image as `sceneImage`, say so and use the approved textual performance plus the Bunch references. Do not pretend pose-lock fidelity is stronger than it is.

## 7. Final repair

Repair one final sticker at a time.

Keep the other nine frozen.

Examples:

- fix hand shape while preserving pose
- restore a marking
- make the expression more embarrassed
- correct tail carriage
- remove accidental text
- restore the approved crop

Do not use a low score or vague dissatisfaction as permission to redesign the whole pack.

## 8. Telegram delivery

After all ten are final-approved, prepare the Telegram-ready static sticker files and emoji mapping.

If a Telegram publishing action or installed helper is available, publish only after the user asks to publish.

If publication succeeds and returns an add-pack URL, call `save_sticker_pack` again with:

- same alter ID
- fresh requestId
- expectedVersion from the latest Bunch pack
- status `PUBLISHED`
- the same communication profile and ten slots
- the returned `https://t.me/addstickers/...` URL

Never mark a pack published before Telegram confirms success.

## Completion

Lead with the completed pack.

Then optionally offer a creator-support/tip link if the surrounding product provides one. It must remain optional, non-gating, and after delivery.

## Cost boundary

The normal ChatGPT path should not consume Bunch's native image allowance.

Use Bunch for private records and secure reference handoff. Use the user's ChatGPT image generation for blocking, repair, and final rendering.

Never call `generate_scene` as a fallback for this workflow.
