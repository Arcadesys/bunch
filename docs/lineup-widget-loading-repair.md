# Lineup widget loading repair — 2026-09-06

Win condition: the widget receives host results and renders profiles, or exits loading with a recovery message.
Budget: one focused loading-path repair and verification pass.

Evidence: the supplied screenshot remains on “Loading your private lineup…” despite narration claiming pictures appeared. Local code omitted the MCP Apps initialization handshake and read window.openai.toolOutput only at startup. The screenshot uses Bunch branding; the local checkout uses DIDdy. This establishes a local defect, not the exact deployed revision.

Kept changes:
- Send ui/initialize after registering listeners; acknowledge the host response with ui/notifications/initialized.
- Accept initial and delayed compatibility globals, including later private image metadata.
- Show a recovery message after 15 seconds without valid data, on malformed/error results, or cancellation. Late valid results can recover.
- Publish alter-lineup-v3 while keeping v1 and v2 readable with the repaired template.
- Describe tool output as prepared data without claiming visible pictures.

Verification: eight focused Node tests passed on the branch, including the MCP descriptor/resource test. Targeted ESLint and TypeScript checks passed. A headless Chromium iframe host completed the handshake, rendered a synthetic profile and decoded its synthetic picture, with no page errors and no horizontal overflow at 390px. Inspected the rendered desktop screenshot. No private records were used or changed.

Current best: local repair verified. Deployment and a fresh authenticated Codex widget mount remain unverified.

References:
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx

Branch preparation: ported the loading repair onto current origin/main in an isolated worktree, preserving Bunch branding, presence badges, and paginated profile loading. Original mixed checkout remains untouched.
