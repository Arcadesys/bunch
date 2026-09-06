# Test gate hardening — 2026-09-06

Win condition: CI rejects silently skipped database tests, browser failures preserve
reports/screenshots/traces, and local gates are reproducible with synthetic data.

Base: main `6bbba71f9556bda59c8469d8c5b874155a29ea48`. Implementation is isolated on
`codex/test-gates`; the original dirty checkout was not changed. No push, merge,
deployment, application behavior, or migration changes were made.

## Attempts and verdicts

- Terra strict-gate assignment: added `test:ci` and real temporary regression
  suites. Review expanded discovery to include domain tests, rejected empty files,
  resolved the loader independently of fixture location, and kept fixture TAP
  diagnostics from being mistaken for actual skipped tests. Kept after verification.
- Terra browser-evidence assignment: CI HTML/JSON reports and failure attachments,
  always-upload step, seven-day retention. Initial shared report folder let the
  HTML reporter remove JSON; discarded that layout. Kept separate JSON and HTML
  paths after checking final files from passing and intentionally failing probes.
- Coordinator: wired strict CI command, ignored generated reports, and documented
  disposable PostgreSQL setup, full verification commands, cleanup, and evidence.

## Final verification

- Fresh native PostgreSQL 16, isolated localhost port 55439: baseline and all ten
  migrations applied successfully. No production credentials or records used.
- Combined strict server suite on Node 22.23.2: 84 passed, zero failed/skipped/TODO.
  Missing TEST_DATABASE_URL rejects the command. Agent regression checks include
  passing, empty, skipped, TODO, failing, malformed-summary, and spawn-error cases.
- Combined production-mode Chromium browser suite: 129 passed, zero skipped,
  unexpected or flaky. Final `test-results/results.json` exists and parses.
- Agent production-mode intentional failure probe: JSON and HTML persisted with
  three failures, three screenshots and three traces. Temporary probes removed.
- Lint, main typecheck, browser typecheck, production build, Python recovery checks,
  portable plugin packaging, and diff whitespace checks passed. Coordinator build
  and browser verification used local Node 26; strict server checks used CI's Node 22.
- GitHub artifact upload is configured and reviewed; this unpublished branch has
  not run on GitHub Actions, so a remotely downloadable artifact is not yet verified.

## Separate finding

The unchanged development-server browser suite passed 126 checks and failed the
same existing saved-record pagination request-count assertion at all three sizes
(expected 2 reads, observed 3). It passed in the production build used by CI.
No assertion was weakened and no application change was made for this finding.

## Current best and handoff

Keep the strict runner and separated evidence paths. Use tests/mobile/README.md
for local reproduction. Publishing/merging, model-response evals, authenticated
production acceptance, and reconciliation of the old checkout remain outside scope.
