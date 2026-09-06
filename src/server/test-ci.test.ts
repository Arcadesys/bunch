import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assessTestProcess, requireTestDatabaseUrl, runStrictTestGate } from "../../scripts/test-ci";

function withFixture(source: string, callback: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "diddy-test-ci-"));
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  writeFileSync(join(sourceDirectory, "fixture.test.ts"), source);
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runFixture(source: string): Error | undefined {
  let error: Error | undefined;
  withFixture(source, (root) => {
    try {
      runStrictTestGate(root, "postgres://fixture");
    } catch (caught) {
      error = caught as Error;
    }
  });
  return error;
}

function runEmptyFixture(): Error | undefined {
  const root = mkdtempSync(join(tmpdir(), "diddy-test-ci-"));
  try {
    runStrictTestGate(root, "postgres://fixture");
    return undefined;
  } catch (caught) {
    return caught as Error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("test:ci requires an explicit test database", () => {
  assert.throws(() => requireTestDatabaseUrl(undefined), /TEST_DATABASE_URL is required/);
  assert.equal(requireTestDatabaseUrl("postgres://test"), "postgres://test");
});

test("test:ci runs a passing fixture and rejects real empty, skipped, TODO, and failing suites", () => {
  assert.equal(runFixture('import test from "node:test"; test("pass", () => {});'), undefined);
  assert.match(runEmptyFixture()?.message ?? "", /no source test files/);
  assert.match(runFixture("export {};")?.message ?? "", /no tests/);
  assert.match(runFixture('import test from "node:test"; test.skip("skip", () => {});')?.message ?? "", /skipped/);
  assert.match(runFixture('import test from "node:test"; test.todo("todo");')?.message ?? "", /TODO/);
  assert.match(runFixture('import test from "node:test"; test("fail", () => { throw new Error("fixture failure"); });')?.message ?? "", /failed tests/);
});

test("test:ci fails closed when TAP summaries are malformed or the child cannot start", () => {
  assert.match(assessTestProcess({ status: 0, output: "# tests 1\n# pass 1\n" }).join("\n"), /omitted/);
  assert.match(
    assessTestProcess({ status: null, output: "", error: new Error("spawn ENOENT") }).join("\n"),
    /could not start/,
  );
});
