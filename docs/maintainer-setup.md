# Bunch maintainer setup

## Local development

```sh
npm install
cp .env.example .env.local
npm run dev
```

`SYSTEM_DEMO_MODE=true` is a visible local walkthrough only. Set it to `false` before deployment. Production authentication uses Auth0 Universal Login with the Google social connection.

The MCP endpoint is `/mcp`; authenticated REST routes are under `/api/v1`. Runtime database access uses `DATABASE_URL`; migrations use `DATABASE_URL_UNPOOLED`.

Hosted MCP verification requires a real Auth0 access token:

```sh
HOSTED_MCP_URL=... HOSTED_MCP_ACCESS_TOKEN=... npm run verify:hosted-mcp
```

Before a production release, verify Auth0 callback/origin settings, MCP resource scope, database migrations, private image storage, website login, and the hosted MCP flow. Keep `SYSTEM_DEMO_MODE=false` in production.
