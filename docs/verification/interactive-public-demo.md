# Interactive signed-out demo — 2026-09-09

Win condition: a signed-out visitor can enter the fictional Demo system from the landing page, try a return and read catch-up, preview a local photo, and create/keep a clearly labeled sample image without accessing private records.

Scope: one focused implementation pass plus targeted fixes. Built from origin/main 40707d6 in codex/interactive-public-demo, preserving the earlier local-only experiment in its original worktree.

The /demo page uses the canonical hosted getDemoSystem snapshot: Fenton, Benny, Dot. Interactions live in component state. Reset/reload clears them; photo blob URLs are revoked on removal/reset/unmount. No tenant identifiers, private services, uploads, mutations, or paid generation calls are introduced. Image creation intentionally previews two prepared SVG illustrations. The page labels this explicitly. The existing public API/MCP snapshot remains read-only.

Verification verdict: PASS for this bounded demo. All 12 browser checks passed after the mobile link fix.
- Application and browser TypeScript checks and targeted ESLint passed.
- Playwright: signed-out landing -> demo -> arrival -> read -> local photo -> sample generation -> gallery -> remove/reset, plus unsupported files and doubled text at 320, 390, and 1440 pixel widths.
- Existing landing checks included. First pass found the secondary introduction link hidden by a mobile navigation class; changed to a dedicated visible link style and reran.
- No private API requests or page errors in the demo journey. Existing landing checks cover console errors and image loading.
- Desktop catch-up and mobile generation screenshots visually inspected. High-contrast surfaces and readable text retained; light theme plus doubled text tested for horizontal overflow.
- Browser plugin absent; regular Playwright used. Local server uses webpack because reused dependencies are symlinked outside this checkout.

Try locally: npm run dev -- --webpack --hostname 127.0.0.1 --port 3126, then open http://127.0.0.1:3126 and choose Try the interactive demo.

Not claimed: live AI generation, real uploads, account transfer, production deployment, or full database CI. No merge/deployment performed.
