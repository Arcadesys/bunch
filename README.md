# Bunch

A private companion for people who keep shared records: who is present, who was
present, and what the next person needs to know.

Bunch is built around one idea — **nothing is inferred**. It records what someone
explicitly says, and a gap in the record means nothing was written down, never
that nobody was there.

It has two front doors onto the same records:

- a **web app** for browsing, editing, and account control
- an **MCP server** so an AI assistant can read and write the same records under
  the same rules

**Working Monkeys** is the engine underneath — the MCP server, the record
services, and the database. Bunch is what you see; Working Monkeys is what runs.

## Getting started

**[SETUP.md](SETUP.md)** walks through running it locally. The short version:

```sh
npm install
cp .env.example .env.local     # set DATABASE_URL and SYSTEM_DEMO_MODE=true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/baseline.sql
npm run db:migrate
npm run dev
```

Demo mode removes the sign-in and cloud-storage requirements. It does **not**
remove the database requirement — there is no database-free mode.

## Documentation

| | |
|---|---|
| [SETUP.md](SETUP.md) | Run it locally, or deploy it for real |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the pieces fit, and which strings are frozen |
| [docs/](docs/) | Reference notes on the presence model, invitations, and visual identity |
| [tests/mobile/README.md](tests/mobile/README.md) | Accessibility checks and the full CI gate |

## What it records

**Hosting** is responsibility for the body; one profile holds it at a time.
**Fronting** is presence in the moment, and episodes may overlap. The two are
tracked independently, and neither implies the other.

Around that: profiles, notes, todos, decisions, important threads, a private
image gallery with shareable links, and a catch-up view that shows an arriving
profile what changed since they were last around.

## Personalized sticker studio

Bunch can keep one ten-reaction creative board per active person at
`/stickers`. The board starts from ten semantic intents such as yes, thanks,
sorry, love, and bye, but the actual acting is individualized: a gesture may be
signed, culturally specific, deadpan, theatrical, tail-led, text-free, or
anything else the person would really use.

The normal ChatGPT workflow deliberately separates acting from likeness:

1. choose the person explicitly
2. interview for communication style and approve all ten performances
3. save the prompt board in Bunch
4. make cheap pose-blocking images in ChatGPT
5. repair only the selected sticker while the other nine stay frozen
6. apply Bunch's selected private appearance references through the existing
   secure ChatGPT image handoff
7. save the confirmed Telegram add-pack URL back to Bunch after publication

This route does not infer the subject from hosting or fronting and does not use
Bunch-native paid image generation as a ChatGPT fallback.

## The MCP surface

The endpoint is `/mcp`, following the Apps SDK interactive-decoupled pattern.
Tool writes and authenticated `/api/v1` writes share one transactional service,
so both paths enforce the same rules.

- `list_alters`, `get_alter`, `create_alter`, `update_alter`, `archive_alter`, `restore_alter`, `preview_erase_alter`, `erase_alter`
- `list_todos`, `get_todo`, `create_todo`, `update_todo`, `archive_todo`, `restore_todo`, `erase_todo`
- `set_note_alter`, `reassign_coverage`, `erase_coverage_record` — narrow erasure-blocker resolution
- `get_companion_state` + `render_system_companion` — the interactive catch-up widget
- `get_current_front` + `switch_current_front` — timestamped, optimistic, retry-safe handoffs
- `get_current_presence`, `set_system_host` — hosting and fronting as independent lifecycles
- `save_system_note`, `save_system_preference` — explicit assistant-to-app handoffs
- `prepare_private_image_upload` — a profile-bound, one-minute capability used only to move a selected image into private storage
- `get_sticker_pack`, `list_sticker_packs`, `save_sticker_pack` — read and persist the explicit ten-reaction creative contract for one selected person, including the final Telegram add-pack URL after confirmed publication
- `suggest_coverage_draft` + `resolve_coverage_draft` — an inspectable, confirmed-only history gate
- `get_recorded_coverage` — confirmed history only

Every tool has an output schema and a closed-world annotation. Reads are marked
read-only, retry-safe writes take request UUIDs, and permanent erasure is marked
destructive. The endpoint validates JWT signature, issuer, audience, expiry, and
scope before deriving the same immutable subject the website session uses.

The MCP app never returns image bytes, access tokens, or raw conversation text.
Only **confirmed** assignments come back from the coverage tool.

## The REST API

Authenticated routes mirror the MCP contracts under `/api/v1`, with item,
archive, restore, erasure-preview, and permanent-delete routes. Mutations require
a UUID in `Idempotency-Key`. The owner ID is always derived from the session
subject, never from the request body.

## Laptop reference API (separate credential domain)

`/account/reference-credentials` is an authenticated account screen for creating a high-entropy credential for a specific laptop and an explicit set of profiles. The plaintext credential is returned once over the signed-in same-origin request; Bunch stores only its SHA-256 hash. Revocation takes effect on the next request.

This API does **not** accept a `system:companion` MCP token and the credential cannot call `/mcp` or `/api/v1`. It exposes only:

- `GET /api/reference/v1/manifest` — the versioned Working Monkey contract: configured `origin`, `manifestVersion`, `selectedAlterIds`, selected alter metadata/version/SHA-256, and flat image entries with `alterId`, ID, version, content type, and SHA-256.
- `GET /api/reference/v1/images/:imageId` — bytes for an image named in that credential's current manifest.

Both calls require `Authorization: Bearer <one-time credential>` and re-check the credential hash, owner, revocation state, active selected profile set, and image selection every time. Only a profile picture or explicitly selected appearance reference is exportable. Notes, tasks, preferences, decisions, presence/fronting/hosting, coverage, catch-up, review, history, activity, storage keys, and all work fields are absent by contract.

Release steps, deliberately not performed by this source change:

1. Review and apply `drizzle/0020_reference_credentials.sql` through the normal Bunch migration process.
2. Deploy Bunch with its existing private image storage configured, then sign in and issue a test credential from the account screen.
3. Verify owner mismatch, deselection/archival, and revocation return `401`; verify the manifest and image hash match the bytes.
4. Put the returned plaintext credential only in the laptop Keychain. Never copy it into `.env`, Working Monkey configuration, or logs.

## Database

`src/db/schema.ts` is the Drizzle model of record. Runtime queries use `pg` with
Vercel Fluid pool attachment and `DATABASE_URL`; migrations use
`DATABASE_URL_UNPOOLED` because they hold a session advisory lock a pooler cannot
keep. Migrations are hand-reviewed forward-only SQL in `drizzle/`, applied by
`scripts/migrate.ts` — they are not generated from the schema.

## Status and licence

This is one person's project, published so the design is readable. It is not
accepting sign-ups, and there is no support commitment.

**No licence is granted.** Without a LICENSE file the default applies: all rights
reserved. You may read the code; you do not have permission to use, modify, or
redistribute it.
