# Bunch Demo

A separate read-only local plugin for the fictional **Demo system**: exactly **Foo**, **Bar**, and **Baz**. It offers sample profiles, notes, shared task relevance, and separate hosting/fronting records. It does not connect to your account or read/write tenant data. It is a walkthrough, not a simulation of all production tools or mutations.

1. From the Bunch source checkout, run `npm run demo`.
2. Open http://127.0.0.1:3100. The default page opens the fictional walkthrough.
3. Add this `plugins/diddy-demo` directory through Codex's supported local-plugin installation controls.
4. Ask Bunch Demo: “Show Demo system, then explain who the picnic task is relevant to.”

The local server must remain running. The demo endpoint is disabled unless `SYSTEM_DEMO_MODE=true`, is always disabled in production builds, and accepts only loopback requests. The existing `plugins/diddy` package and authenticated `/mcp` endpoint remain the private production connection. No production configuration changes are required. Restarting gives the same read-only sample content.
