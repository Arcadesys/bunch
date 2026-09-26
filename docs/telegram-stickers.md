# Hosted Telegram sticker uploader

The authenticated Bunch MCP server exposes `prepare_telegram_sticker_pack` and
`publish_telegram_sticker_pack`. The `upload-telegram-stickers` skill is available
through MCP `skills/list`, `skills/get`, and `resources/read`, and in the portable
Bunch plugin package. Eligible signed-in users connect Telegram from Account &
Privacy. Account linking is separate from approval to publish any pack.

## First-version boundary

Use 1–50 selected private Bunch image IDs with a title, slug, emoji and keywords.
Only transparent static PNGs are supported: at most 512 KB, one side exactly
512px, neither side larger. The server decodes pixels before approving them.
Original bytes are uploaded without conversion. For supplied local files, use the
existing private image upload flow first; this version does not import a ZIP.
A saved sticker direction board is metadata, not a set of rendered images.

Preparation reads the configured Telegram bot identity and verifies the configured
owner is an accessible private chat. It uploads no images. Its 15-minute signed
approval binds the authenticated Bunch owner, Telegram user, bot, title, slug,
ordered image IDs, emoji, keywords and SHA-256 hashes. The publish call requires
`confirmPublicUpload: true`, reauthorizes and rereads every image, checks the
hashes, and sends one multipart `createNewStickerSet` request. Prepared tokens
work across stateless MCP invocations and server restarts while configuration
remains unchanged. Tokens contain metadata, never credentials or image bytes;
keep them out of public logs nonetheless.

Publishing transfers private image bytes to Telegram and creates a shareable
pack. A preparation request, attached README, saved draft or implementation
request does not authorize publication. Review the exact pack and destination
with the user, retaining any explicit authorization already provided.

## Account linking and operator setup

Configure one application bot with `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_OIDC_CLIENT_ID`, and `TELEGRAM_OIDC_CLIENT_SECRET` in server-only
secrets. Never ask a user for a bot token or numeric Telegram ID. Users link their
own account through Telegram Login and confirm the returned account in Bunch.
If Telegram requires bot access, the Account & Privacy panel offers a Start link
and a recheck action. The app does not send an automatic direct message.

Linking does not authorize public uploads. Each exact sticker pack still needs a
separate user review and approval before publication. Disconnecting does not
remove packs already published to Telegram. Existing operator mappings are not
silently treated as verified user links. Do not infer account ownership from
hosting or fronting.

## Results and retries

- `created_verified`: Telegram accepted creation, then returned the expected
  name, title and sticker count. This is not remote image-fidelity verification.
- `created_unverified`: Telegram accepted creation, but the read-back failed or
  differed. Inspect the returned link.
- `uncertain`: a write response was interrupted or ambiguous. The pack may exist.
  Retry with the same name after reviewing/preparing again if approval expired.
- `existing_unverified`: that name exists. Nothing was uploaded, appended,
  replaced or deleted. Its contents are not asserted to match the selected files.

Names include the slug, Telegram owner ID and required bot suffix. They are
limited to 64 characters; long slugs can be truncated, so review the returned
name before publication. The name provides safe existence checks across retries,
not a content-identity guarantee. Concurrent requests can race to creation; only
one can create a given name and an API rejection remains an error. Never append
or switch names automatically after uncertainty. Choose a new slug only for an
explicitly requested new version. Rate limits return a delay without automatically
replaying the write. No publication receipt or credentials are persisted in the
Bunch database; the structured result is the receipt and Telegram is read back
for verification.

## Verification

Run `node --import tsx --test src/server/telegram-stickers.test.ts
src/server/system-skill.test.ts src/server/mcp-server.test.ts`, `npm run lint`,
`npm run typecheck`, and `python3 scripts/package-plugin.py`.
The tests cover MCP transport, PNG decoding, cross-owner and expired/tampered
approval, changed bytes, multipart mapping, safe errors, same-name retries and
skill packaging. They fake Telegram; they do not prove authenticated publication.
For a live acceptance test, configure the intended owner, prepare a small pack,
obtain publication authorization, publish, verify `created_verified`, then open
the returned Telegram pack. Do not use private character assets for an unsolicited
live test.

The supplied Mouse Arcade archive was used as a format reference and an offline
validation fixture only. Its private images are not distributed in the plugin.
The standalone script's automatic chat message is deliberately not part of this
hosted uploader.

Official contracts checked 2026-09-26:
[pack creation](https://core.telegram.org/bots/api#createnewstickerset),
[InputSticker](https://core.telegram.org/bots/api#inputsticker), and
[sticker formatting](https://core.telegram.org/stickers).
