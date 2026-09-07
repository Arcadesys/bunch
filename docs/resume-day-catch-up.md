# Resume-day catch-up — 2026-09-06

Win condition: a useful saved-record briefing with Needs attention, What changed, and Next step, no more than three initial priority items, and explicit empty, failed, and dated-record states.

This bounded pass adds expandable records and saved conversation coverage, one-action overwhelmed mode with heading focus, retained records on failed refresh (cleared on authorization failure or episode selection), stable review retry receipts, dated presence with optional uncertainty/dismissal, and a gallery link on portrait failure. Current main's mobile task navigation, independent presence controls, and saved-review endpoint are preserved.

Verification: lint, application/browser type checks, build, and diff checks passed. Local unit tests passed 61 with 18 database-gated skips. The full production browser run passed 200 of 201; the remaining 320px enlarged-text overflow was fixed with wrapping. All 39 affected experience/catch-up checks then passed across desktop and two phone sizes. Development-mode note pagination made one extra read, so acceptance used production mode as CI does. Screenshots inspected using synthetic records.

Current best: ready for PR CI, including its real Postgres-backed tests and complete production browser suite. Actual Android TalkBack/voice and authenticated production gallery rendering remain unverified. Conversational corrections and combined saves are later scope.
