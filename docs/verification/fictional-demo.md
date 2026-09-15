# Fictional demo verification — 2026-09-09

Win condition: the default local demo and its plugin clearly show Demo system with exactly Foo, Bar, and Baz, distinct sample content, and no private tenant access.

Budget: one implementation pass and targeted verification/fixes.

Current best: a separate local, read-only fixture module, walkthrough page, MCP server, and Bunch Demo plugin package. The root redirects to the walkthrough only when local demo mode is enabled. Production builds disable both new demo surfaces. The existing private MCP connection and tenant storage code are unchanged. This does not retrofit legacy catch-up fixtures or simulate the complete production tool set.

Why this boundary: the old demo combines an empty memory repository with database-backed services. A complete service simulation would exceed this focused pass. The new demo imports no database or repository and provides five read-only tools.

Verification verdict: PASS for the bounded walkthrough.

- Four targeted tests passed: exact names/shared relevance/independent snapshots; explicit opt-in and production exclusion; actual MCP client reads and unknown-mutation rejection; HTTP disabled/production/non-loopback/cross-origin rejection.
- TypeScript and targeted ESLint passed; diff whitespace check passed.
- Actual HTTP MCP initialization and get_demo_system passed at http://127.0.0.1:3100/demo/mcp.
- Playwright rendered http://127.0.0.1:3100 -> /demo at 1280×900 and 390×844. Correct title, all three names, working sample-content anchor, no horizontal overflow or page errors. Desktop and mobile screenshots visually inspected for readable text and wrapping.
- Browser plugin not available; regular Playwright used per frontend testing skill.
- Local dependencies were reused through an ignored node_modules symlink. Turbopack rejected that external symlink; `npm run demo -- --webpack` passed. A normal dependency installation can use `npm run demo`.

Not verified: installation through Codex UI, production build, full database-backed suite, deployment. No merge, deployment, personal-system seed, or production access change was performed.

Try it: `npm run demo` (in this linked-dependency checkout: `npm run demo -- --webpack`), open http://127.0.0.1:3100, and install the separate plugins/diddy-demo directory using supported Codex local-plugin controls.
