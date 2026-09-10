# Group Photo composition checkpoint — 2026-09-09

Win condition: normal UI places and groups character tokens, provides all four Arrange actions, and a Playwright run generates, persists and displays a real usable group photo.

Budget: one cohesive implementation, targeted checks, one real generation acceptance attempt when an application provider is available.

## Current best

- Select a person and tap the scene, drag a placed token, or use keyboard arrows and named Move controls. Moving preserves depth instead of resetting it to a provisional zone.
- Bring Forward, Send Backward, Bring to Front, Send to Back persist the complete order in one owner-scoped transaction under the project version lock. Larger depth means nearer the viewer. Equal legacy depths sort deterministically.
- The People tray selects people obscured by overlapping tokens. Saved projects reopen from their URL, including after a version conflict.
- Scene geometry follows the actual image aspect ratio; broad provisional zones no longer obstruct direct placement. Token labels remain inside the scene and movement buttons have solid high-contrast backgrounds.
- MCP preparation now requests one natural group composition. Nearby left-side tokens explicitly mean those people together on the left. Canonical visual-identity prompting and selected appearance references remain in the existing preparation path.

## Verification and iteration trail

- Domain tests: tied depths, one-step and extreme Arrange actions, boundary behavior, unchanged input, and coordinate/grouping instructions pass.
- Playwright interaction tests use mocked data (not generation). Three viewport runs pass: 320px, 390px and desktop. They cover placing three people on the left, all four Arrange actions, keyboard and pointer moves preserving depth, a rejected save retaining the previous position, reopening the saved scene and no horizontal overflow.
- Initial screenshot inspection found clipped labels at the left edge of a narrow scene. Kept a correction that anchors labels within scene bounds.
- Expanded tests found the deliberately overlapped rear token could not be clicked through the front token after reload. Verification now uses the ordinary People tray to select the obscured person; stacking remains faithful to Arrange order.
- Application and browser typechecks, targeted ESLint and diff whitespace checks pass. Browser entry inspection returned meaningful content with no framework error overlay.
- Rendered evidence is synthetic staging UI, not a generated photo.

## Remaining acceptance gap

The source currently implements staging and an external MCP render-preparation packet only. There is no application image-generation endpoint, persisted generated-result record or ordinary UI generation action. No real-generation Playwright test has been completed. No provider request, generated-image persistence or generated-result display has passed.

Safe inspection found database and private Blob configuration in the main checkout's local environment, but no image-provider credential. The new worktree has no local environment file. No secrets were copied or printed, and no production data or migrations were changed.

Next bounded step: resolve the application-callable generation provider and credential setup, implement its generation/result lifecycle with selected-reference preservation, and add a separate non-mocked Playwright test that calls the provider and independently verifies persistence and displayed image decoding. Do not treat the existing interaction suite as that acceptance test.

The user subsequently authorized merge and deployment of this bounded composition change. Real generation remains a separate, explicitly unverified acceptance gap.
