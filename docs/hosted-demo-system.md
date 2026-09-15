# Demo system

Bunch serves one fixed, explicitly fictional sample for demonstrations. The plugin fetches it from the hosted API; there is no SQLite bundle, database seed, tenant migration, or account creation.

## Access

- Existing plugin endpoint: `/mcp`. With no Authorization header, initialize and list tools, then call `get_demo_system` with `{}`. The structured result is labeled `Demo system`, `fictional: true`, and `readOnly: true`.
- Direct JSON: `GET /api/demo/system`. This explicitly public endpoint always returns only the fictional sample, even if a browser has a session.
- Private access: `connect_private_system` advertises OAuth and challenges anonymous callers. After sign-in, refresh `tools/list`. Authenticated requests use the existing verified-owner server, including its pilot access gate. `get_companion_state` and all existing private tools continue to operate on that owner alone.
- An explicitly requested `get_demo_system` remains available after authentication; it is never substituted for private results.

Only an absent Authorization header selects anonymous MCP discovery/demo. Empty, malformed, expired, wrong-audience, wrong-scope, and revoked credentials still fail authentication. Anonymous private tool calls, resources, and mutations remain protected. An anonymous GET stream probe receives 405 because this stateless endpoint has no SSE stream; it does not prompt demo visitors to sign in. Responses are not cached. No data is accepted for storage by the demo endpoint.

## Explore through the plugin

The anonymous tool list includes eight read tools plus the OAuth connection tool. Start with “Show the Demo system,” then try:

- “Show Benny's open tasks.” (`list_demo_tasks`, `relevantTo: benny`, `status: OPEN`)
- “What reminder did Fenton leave Benny?” (`list_demo_notes`, `author: fenton`, `relevantTo: benny`)
- “Show Fenton's hosting and fronting history.” (`list_demo_history`, `personId: fenton`)
- “What does Benny need to catch up on?” (`get_demo_catch_up`, `personId: benny`)
- “Who is Dot?” (`get_demo_person`, `personId: dot`)

Every response is labeled Demo system. There are no write tools in the anonymous demo. These are distinct fictional tools; the real-system `list_alters`, notes, tasks, and presence tools remain private.

## Fictional content

The people are named Fenton, Benny, and Dot directly, replacing the exploratory Foo/Bar/Baz names. Dot is a kid and no relation to Fenton or Benny. Fenton and Benny tease each other and really love each other. Fenton handles household scheduling; Benny handles emotional writing.

The open task is **Write a thank-you note for the gift we received.** Fenton leaves the reminder; Benny handles the writing; the gift was received by the system. The donor, gift, and deadline are unspecified. Both people are relevant to the commitment independently of hosting or fronting.

The dated snapshot includes Fenton's continuing hosting period, explicitly ended fronting, overlapping Benny/Dot fronting, earlier scheduling work, a reminder, Benny's reply, and a sample catch-up. The catch-up cites only records within its stated window (plus the open task), not the later reply. Fictional review state is separate from task completion. Dates are fixed story context, never live presence.

## Scope

This is a read-only API walkthrough. It neither creates a writable demo tenant nor modifies the local-only legacy walkthrough fixtures. It contains no private images, personal records, inferred species, or invented family relationships. No changes are required to production `SYSTEM_DEMO_MODE`; keep that legacy flag disabled.

The protocol supports an OAuth transition through `connect_private_system`; a specific host may require reconnecting its MCP connection to refresh available tools. Browser sign-in alone does not give an MCP client a bearer token.
