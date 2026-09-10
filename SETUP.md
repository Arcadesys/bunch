# Working Monkeys — run Bunch on your own machine

**Working Monkeys** is the engine: the MCP server, the record services, and the
database behind them. **Bunch** is the product you see in the browser. This guide
gets Working Monkeys running locally so you can poke at Bunch.

There are two paths:

| Path | What you need | What you get |
|---|---|---|
| **A — Local walkthrough** | Node 22, Postgres 16 | The whole app, no accounts to sign up for |
| **B — Real deployment** | Path A, plus Auth0 and blob storage | Sign-in, cloud storage, a live MCP endpoint |

Start with Path A. It is the one to reach for when you just want to see the thing
run, and it needs no cloud account of any kind.

> **A database is required either way.** Demo mode removes the sign-in and
> cloud-storage requirements, but the app still reads and writes Postgres. There
> is no database-free mode — every data route returns a 500 without one.

---

## Path A — local walkthrough

### 1. Prerequisites

- **Node.js 22**
- **PostgreSQL 16** — either a local server or the disposable Docker container below
- `psql` on your PATH

### 2. Start a database

With Docker:

```sh
docker run --detach --rm --name bunch-dev-postgres \
  -e POSTGRES_USER=bunch -e POSTGRES_PASSWORD=bunch \
  -e POSTGRES_DB=bunch_dev -p 127.0.0.1:5432:5432 postgres:16
until docker exec bunch-dev-postgres pg_isready -U bunch -d bunch_dev; do sleep 1; done
```

Already running Postgres locally? Just create a database:

```sh
createdb bunch_dev
```

### 3. Configure

```sh
npm install
cp .env.example .env.local
```

For Path A, `.env.local` needs exactly four values. Everything else can stay blank:

```sh
DATABASE_URL=postgres://bunch:bunch@127.0.0.1:5432/bunch_dev
DATABASE_URL_UNPOOLED=postgres://bunch:bunch@127.0.0.1:5432/bunch_dev
SYSTEM_DEMO_MODE=true
SYSTEM_PUBLIC_ORIGIN=http://localhost:3000
```

`SYSTEM_PUBLIC_ORIGIN` has no default on purpose. A clone with no configuration
should fail loudly rather than quietly point at somebody else's deployment.

### 4. Create the schema

```sh
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/baseline.sql
npm run db:migrate
```

`baseline.sql` is the original empty schema; `npm run db:migrate` applies the
reviewed forward migrations in `drizzle/` on top of it. Run both, in that order,
exactly once per fresh database.

### 5. Run it

```sh
npm run dev
```

Open <http://localhost:3000>.

### What works, and what does not

Working in demo mode:

- Home and catch-up, Board, Profiles, Notes, Decisions, Threads, History
- Creating and editing profiles, todos, notes, and decisions
- Hosting and fronting records
- Image upload, written to `private-uploads/` on local disk

Not working in demo mode, by design:

- **Anything needing a real identity.** Account export, deletion, and recovery go
  through `requirePilotIdentity`, which has no demo path — it wants a real Auth0
  subject. That is Path B.
- **Cloud image storage.** Vercel Private Blob is bypassed entirely.
- **A hosted MCP endpoint.** `/mcp` verifies real Auth0 tokens.

### One thing not to do locally

Do not run `npm run pilot:admin -- lock-gate` against a local database. It turns
on membership enforcement, after which every account without a pilot record —
including the demo user — is refused. A fresh database has the gate off, which is
why Path A works at all.

---

## Path B — real deployment

Path B adds real sign-in and cloud storage on top of Path A. Set
`SYSTEM_DEMO_MODE=false` and fill in the rest of `.env.local`.

### Auth0

Sign-in stays disabled until all four `AUTH0_*` values are present. In your Auth0
tenant, with `$ORIGIN` standing in for your deployed origin:

1. Create a **Regular Web Application** and enable **only** the Google social
   connection.
2. Allow `$ORIGIN/auth/callback` as a callback URL, and `$ORIGIN` as both a logout
   URL and an allowed web origin.
3. Create an **API** whose identifier is `$ORIGIN/mcp`, signing algorithm RS256,
   with the scope `system:companion`.
4. In tenant **Advanced Settings**, enable **Resource Parameter Compatibility
   Profile** and **Include Issuer in Authorization Responses**.
5. Promote the Google connection to a **domain-level connection** so third-party
   MCP clients can use it.
6. Set `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`,
   `APP_BASE_URL`, `MCP_RESOURCE_URL`, and `SYSTEM_PUBLIC_ORIGIN` in your host's
   environment. Keep `SYSTEM_DEMO_MODE=false`.
7. Verify the website login and the MCP flow with MCP Inspector before connecting
   the same `/mcp` URL in a ChatGPT client.

`APP_BASE_URL` is read inside the Auth0 SDK rather than by application code, so
searching the source for it finds nothing. It is still required.

### Secrets

`MCP_TOKEN_SIGNING_SECRET` and `ERASURE_TOKEN_SIGNING_SECRET` sign short-lived
capability tokens and must be independent values:

```sh
openssl rand -hex 32
```

`CRON_SECRET` guards the scheduled cleanup route that expires old records.

### Connecting an MCP client

The endpoint is `/mcp`. `SYSTEM_PUBLIC_ORIGIN` must be set or the server refuses
to start. Self-hosters should edit `plugins/bunch/.mcp.json`, which ships pointing
at the maintainer's deployment rather than yours.

Run acceptance against a live deployment with a real access token:

```sh
HOSTED_MCP_URL=... HOSTED_MCP_ACCESS_TOKEN=... npm run verify:hosted-mcp
```

---

## Running the checks

Fast checks, no database needed:

```sh
npm run lint
npm run typecheck
npm run typecheck:browser
```

The server suite needs a throwaway database and refuses to run without one,
rather than silently skipping the tests that matter:

```sh
export TEST_DATABASE_URL='postgres://bunch:bunch@127.0.0.1:5432/bunch_test'
export DATABASE_URL_UNPOOLED="$TEST_DATABASE_URL"
export SYSTEM_PUBLIC_ORIGIN='http://localhost:3000'
createdb bunch_test
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/baseline.sql
npm run db:migrate
npm run test:ci
```

To reproduce the full CI gate — including the browser evals and plugin packaging —
follow **Reproduce the strict CI gates locally** in
[`tests/mobile/README.md`](tests/mobile/README.md). That runbook is the source of
truth; this guide does not duplicate it.

---

## Troubleshooting

**`Postgres is not configured.`** — `DATABASE_URL` is unset. Demo mode does not
remove the database requirement.

**`SYSTEM_PUBLIC_ORIGIN is not configured.`** — Set it. There is deliberately no
fallback.

**Every data route returns 500, but pages still load.** — The page shells are
server-rendered and will render before any data fetch. This almost always means
the schema was never created: run `db/baseline.sql`, then `npm run db:migrate`.

**`TEST_DATABASE_URL is required for test:ci`** — Expected. The suite refuses to
run rather than pass with database tests quietly skipped.

**Sign-in does nothing.** — All four `AUTH0_*` values must be present before
sign-in activates. With any of them missing, only demo mode works.
