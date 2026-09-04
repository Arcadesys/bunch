# Mobile checks and acceptance evals

Win condition: browser flows have explicit assertions at 320px, 390px and desktop;
accessibility and incomplete workflows produce visible failures, not assumed passes.

## Run

```sh
npm ci
npx playwright install chromium
npm test
npm run typecheck:browser
npm run test:mobile
npm run eval:mobile
# Both browser groups:
npm run test:browser
# Verify the production bundle after building:
npm run build
MOBILE_TEST_SERVER=production npm run test:browser
```

`test:mobile` exercises catch-up reads, review writes, reload, deferral, conflict
handling, navigation, thread suggestion/confirmation, and first-time/empty states.

`eval:mobile` is a deterministic user-experience acceptance gate, not an LLM judge.
It checks theme access/persistence, 200% root-text reflow with long content, a 44px
project touch-target goal, truthful signed-out UI, note/todo save feedback, and a
usable explicit front-switch flow. It also covers current-front session guards,
cancel/focus return, profile pagination, duplicate confirmation, lost-response
retry, late-read races, save failures, and stale thread confirmation. Any future
failures must stay visible: repair behavior rather than weakening an assertion
or marking it expected-fail.
The 44px target is a project usability goal, not a claim of full WCAG conformance.

## Isolation and evidence

- A dedicated localhost server on port 3217; no existing server is reused.
- Auth0, database and Blob configuration are blank; demo mode is off.
- Browser API requests use per-test synthetic fixtures. Unhandled API or external
  requests are blocked and fail the test. No production records or images are used.
- Fixture reload proves frontend handling of returned server state, not durable
  database persistence. Separate service checks cover the in-memory demo branch;
  `src/server/catch-up.integration.test.ts` exercises durable catch-up and owner
  isolation on PostgreSQL when `TEST_DATABASE_URL` is explicitly configured.
- Screenshots and failure traces live outside the repository under the OS temp
  directory `system-mobile-tests`. Set `MOBILE_TEST_OUTPUT` to preserve a run in a
  separate directory. Traces contain synthetic test content only.
- The Browser plugin/skill was not available; regular Playwright is used.

## Still separate gates

PostgreSQL tests require an explicitly designated disposable `TEST_DATABASE_URL`.
For a fresh empty test database, first apply `db/baseline.sql`, then run
`npm run db:migrate` with `DATABASE_URL_UNPOOLED` pointing to that same database.
Never apply the baseline to an existing database or point tests at production.
Authenticated production, real phone Safari/Chrome, ChatGPT widget mounting, private gallery/media,
screen-reader use, full contrast auditing and actual browser zoom remain separate
acceptance gates. This suite uses Chromium viewport emulation and the development
server by default (or the production bundle with `MOBILE_TEST_SERVER=production`);
root-text enlargement is a reflow stress test, not real pinch/page zoom.
