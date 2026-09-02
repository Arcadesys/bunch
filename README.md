# System — private DID companion

This is an MCP-first, private-first vertical slice for `system.arcades.me`. ChatGPT is the main workflow; the web companion handles Google sign-in, authorization, and private image storage.

## Current win condition

1. Sign in with Google (or deliberately use local demo mode).
2. Use the ChatGPT app to send and retrieve private profiles, notes, to-dos, preferences, and images.
3. Create a draft coverage suggestion with concise reasons.
4. Confirm, change, or reject the draft in ChatGPT.
5. Ask the ChatGPT MCP app for recorded coverage during last week.

Only **confirmed** assignments are returned by the coverage-handoff tool. The MCP app sends and retrieves user-authorized profiles, notes, to-dos, preferences, and image metadata; it never returns image bytes, access tokens, or raw ChatGPT conversation text.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

With `SYSTEM_DEMO_MODE=true`, the local UI sends `x-system-demo: local`; it is an intentionally visible walkthrough mode. Set it to `false` before any real deployment. Production authentication uses Auth0 Universal Login with only its Google social connection enabled.

The app uses `private-uploads/` only for the local walkthrough. In a configured production environment it uses Vercel Private Blob; the database keeps only the opaque Blob pathname and the owner-authorized route streams the file with private, no-cache headers.

## ChatGPT app

The MCP endpoint is `/mcp` and follows the Apps SDK interactive-decoupled pattern. Alter and todo writes share one transactional service with the authenticated `/api/v1` routes.

- `list_alters`, `get_alter`, `create_alter`, `update_alter`, `archive_alter`, `restore_alter`, `preview_erase_alter`, `erase_alter`
- `list_todos`, `get_todo`, `create_todo`, `update_todo`, `archive_todo`, `restore_todo`, `erase_todo`
- `set_note_alter`, `reassign_coverage`, `erase_coverage_record` — narrow erasure-blocker resolution
- `get_companion_state` + `render_system_companion` — primary interactive ChatGPT companion
- `get_current_front` + `switch_current_front` — timestamped, optimistic, retry-safe fronting handoffs
- `save_system_note`, `save_system_preference` — existing explicit ChatGPT-to-System handoffs
- `prepare_private_image_upload` — a profile-bound, one-minute capability used only by the ChatGPT widget to transfer a selected image into private storage
- `suggest_coverage_draft` + `resolve_coverage_draft` — inspectable, confirmed-only history gate
- `get_recorded_coverage` — confirmed history and a concise “go talk to $ALTER” handoff

Every tool has an output schema and closed-world annotation. Reads are marked read-only; retry-safe CRUD uses request UUIDs; permanent erasure is marked destructive. Hosted tool descriptors require the `system:companion` OAuth scope. The endpoint validates Auth0 JWT signatures, issuer, audience, expiry, and scope before deriving the same immutable Auth0 subject used by the website session.

Run hosted natural-language acceptance with a real Auth0 access token issued for the MCP resource: `HOSTED_MCP_URL=... HOSTED_MCP_ACCESS_TOKEN=... npm run verify:hosted-mcp`. The verifier does not mint or accept a private fallback token.

## REST API

Authenticated routes mirror the MCP contracts under `/api/v1/alters` and `/api/v1/todos`, with item, archive, restore, erasure-preview, and permanent-delete routes. Current-front reads and switches are available at `/api/v1/fronting/current` and `/api/v1/fronting/switch`. Mutations require a UUID in `Idempotency-Key`; `ownerId` is always derived from the Auth0 session subject. Narrow note and coverage blocker routes live under `/api/v1/notes/:id/alter` and `/api/v1/coverage/:id`.

## Database

`src/db/schema.ts` is the Drizzle model. Runtime queries use `pg` with Vercel Fluid pool attachment and `DATABASE_URL`; `scripts/migrate.ts` uses `DATABASE_URL_UNPOOLED`. `db/baseline.sql` captures the original empty schema and `drizzle/0001_mcp_crud.sql` is the reviewed forward migration.

## Auth0 production checklist

1. Create an Auth0 Regular Web Application for the website and enable only the Google social connection.
2. Allow `https://system-arcades-me.vercel.app/auth/callback` as a callback URL and `https://system-arcades-me.vercel.app` as a logout URL and web origin.
3. Create an Auth0 API whose identifier is `https://system-arcades-me.vercel.app/mcp`, signing algorithm is RS256, and scope is `system:companion`.
4. In tenant Advanced Settings, enable **Resource Parameter Compatibility Profile** and **Include Issuer in Authorization Responses**.
5. Promote the Google connection to a domain-level connection so third-party MCP clients can use it.
6. Add `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`, and `MCP_RESOURCE_URL` to Vercel; keep `SYSTEM_DEMO_MODE=false`.
7. Verify the website login and MCP flow with MCP Inspector before connecting the same `/mcp` URL in ChatGPT Developer Mode.
