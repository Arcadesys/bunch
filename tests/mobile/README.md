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

## Reproduce the strict CI gates locally

Use Node.js 22, Python 3, PostgreSQL 16 client tools (`psql`, `pg_dump`, `pg_restore`, `createdb`, `dropdb`), and Docker for the disposable
PostgreSQL 16 instance below. Run from a clean checkout without production `.env`
files. Port 55439 and the container name must be unused; browser checks use 3217.

```sh
npm ci
npx playwright install chromium
# On Linux, use: npx playwright install --with-deps chromium
docker run --detach --rm --name bunch-gate-postgres \
  -e POSTGRES_USER=bunch_test -e POSTGRES_PASSWORD=local_ci_test \
  -e POSTGRES_DB=bunch_test -p 127.0.0.1:55439:5432 postgres:16
until docker exec bunch-gate-postgres pg_isready -U bunch_test -d bunch_test; do
  sleep 1
done
export TEST_DATABASE_URL='postgres://bunch_test:local_ci_test@127.0.0.1:55439/bunch_test'
export DATABASE_URL_UNPOOLED="$TEST_DATABASE_URL"
export SYSTEM_PUBLIC_ORIGIN='http://127.0.0.1:3217'
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/baseline.sql
npm run db:migrate
npm run lint
npm run typecheck
npm run typecheck:browser
npm run test:ci
python3 scripts/test-pilot-recovery.py
npm run build
MOBILE_TEST_SERVER=production npm run test:browser
npm run plugin:pack
# Run after verification, including when an earlier check fails:
docker stop bunch-gate-postgres
unset TEST_DATABASE_URL DATABASE_URL_UNPOOLED
```

Stop at the first failed check and inspect its output. The container has no mounted
volume: stopping it removes the disposable database. A native PostgreSQL 16 instance
is also suitable if you create a fresh, dedicated database and use its URL instead.

`test:ci` requires `TEST_DATABASE_URL` and rejects failures, an empty suite, skipped
checks, and TODO checks. `npm test` remains the lightweight command that permits
unconfigured database checks to skip. These are synthetic server/MCP scenarios and
browser acceptance checks, not model-response quality evaluations.

## CI browser evidence

CI writes per-test failure screenshots and traces to `test-results/playwright`,
a machine-readable report at `test-results/results.json`, and an HTML report in
`playwright-report`.
The `bunch-browser-evidence` Actions artifact is uploaded even after failure and
retained for seven days. If the browser step never starts, there may be no evidence
to upload; the earlier failed step remains the diagnostic source.

After downloading and extracting the artifact, open the HTML report with
`npx playwright show-report playwright-report`, or open a failure trace with
`npx playwright show-trace path/to/trace.zip`. Reports contain synthetic fixtures.
To reproduce CI reporting locally, run
`CI=true MOBILE_TEST_SERVER=production npm run test:browser` after building.
Normal local runs continue to write screenshots and traces under the OS temporary
directory (or `MOBILE_TEST_OUTPUT`) without creating repository report folders.
