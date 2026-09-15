# Architecture

Bunch is a Next.js App Router application with two front doors onto one set of
records: a web UI and an MCP server that a ChatGPT app drives. The interesting
design decisions are the ones that keep those two doors honest with each other.

## Layers

```
src/domain/    Pure types and zod contracts. No I/O, no database, no framework.
src/server/    Services, the MCP server, authentication, storage.
src/app/       App Router pages and /api/v1 routes.
src/db/        Drizzle schema and the connection pool.
```

`src/domain` is shared by the MCP tools, the REST routes, and the database read
shapes. One definition serves all three, which is why changes there must be
additive — a narrowed contract rejects stored rows and cached tool descriptors
at the same time.

## Two surfaces, one core

The `/api/v1` routes and the MCP tools are not parallel implementations. Both
call `SystemService`, which owns the transactional rules:

- Every mutation carries an **expected version**. A stale version is rejected
  rather than silently overwriting a concurrent change.
- Every mutation carries a **request ID**. A retry replays the recorded receipt
  instead of applying the change a second time, so a lost response is safe.
- Mutations write an activity event, which is what catch-up later reads.

Adding a capability to one surface and not the other is almost always a mistake.

## Two data paths (this surprises people)

There are two storage abstractions, and they coexist deliberately:

- **`SystemService`** (`src/server/system-service.ts`) — the versioned,
  transactional path. Always Postgres. Everything new belongs here.
- **`repository`** (`src/server/repository.ts`) — an older, simpler interface
  chosen once at import time: in-memory under `SYSTEM_DEMO_MODE`, Postgres when
  `DATABASE_URL` is set, and otherwise a stub that throws on use rather than
  pretending to be empty.

`src/app/api/system/route.ts` calls both in a single handler. That is not a bug;
it is the seam between the two, and it is the reason demo mode removes the
sign-in requirement but not the database requirement.

## Presence: hosting vs fronting

The domain distinction that most of the app hangs off:

- **Hosting** is responsibility for the body. One profile holds it at a time.
- **Fronting** is presence in the moment. Episodes may overlap.

Neither implies the other. Nothing infers a switch from identity, silence, tone,
or a request for catch-up — only an explicit statement starts or ends a period.
And a missing record never establishes absence: gaps mean nothing was written
down, not that nobody was there.

`docs/hosting-fronting-model.md` has the full contract.

## Catch-up

Catch-up is a **review layer over records that already exist**. Marking an item
reviewed records that an arriving profile has seen it; it never edits or
completes the underlying note, todo, or decision.

Conversation summaries are host-composed and saved for 30 days with their window
and coverage gaps. Raw transcripts are never persisted. A daily cron expires
them.

## Access control

Owner IDs always derive from an immutable identity-provider subject, never from
anything a caller supplied as data — so a model cannot reach another owner's
records by naming them.

In front of that sits the **pilot gate** (`src/server/pilot-service.ts`). An
account with no pilot record is allowed only while the gate is off, which is what
a freshly migrated database looks like. Turning the gate on locks out every
pre-existing account that was never enrolled — deliberate, and effectively
one-way.

## Private images

Image bytes never enter model-visible output. Production stores the file in
private blob storage and keeps only its opaque pathname; an owner-authorized
route streams it back with private, no-cache headers. The ChatGPT widget can
obtain a one-time, short-lived, profile-bound upload capability — enough to
transfer one image into private storage, and nothing else.

Demo mode writes to `private-uploads/` instead, so a local run needs no cloud
account.

## Frozen contracts

Three strings look like stale branding and are load-bearing. Each is commented in
place; changing any of them breaks something that will not fail loudly.

| What | Where | Why it cannot move |
|---|---|---|
| `ui://system-arcades-me.vercel.app/...` | `src/server/mcp-server.ts` | Cache keys held by live ChatGPT conversations. The list is append-only. |
| `hashtext('system-arcades-me:migrations')` | `scripts/migrate.ts` | The advisory-lock key itself. Changing it lets a rolling deploy migrate concurrently. |
| `"DIDDY"` in `sourceReferences.kind` | `src/domain/conversation-summary.ts` | A persisted literal, re-parsed on every read. It renders as "Bunch record" and is never shown raw. |

The backup format tag in `scripts/pilot-backup.ts` is the same kind of thing:
renaming it makes existing archives unrestorable, and the prune patterns key off
the matching filename.

## Migrations

`src/db/schema.ts` is the model of record, but migrations are **not** generated
from it. `drizzle/*.sql` are hand-reviewed, forward-only files applied by
`scripts/migrate.ts` under a session advisory lock. `drizzle-kit` is used only to
check the model against the migrations (`npm run db:check`).

## The skill snapshot

The System Companion skill text exists in three places that must stay
byte-identical:

- `skills/system-companion/SKILL.md`
- `plugins/bunch/skills/system-companion/SKILL.md`
- `SYSTEM_SKILL_TEXT` in `src/server/system-skill.ts`

`system-skill.test.ts` and `scripts/package-plugin.py` both assert it, so any
wording change is a three-file edit.
