import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const tsxLoader = createRequire(import.meta.url).resolve("tsx");

type TestProcessResult = {
  status: number | null;
  output: string;
  error?: Error;
  testFiles?: string[];
};

export function requireTestDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("TEST_DATABASE_URL is required for test:ci");
  }
  return value;
}

export function findServerTestFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

export function assessTestProcess(result: TestProcessResult): string[] {
  const { status, output, error, testFiles = [] } = result;
  const errors: string[] = [];
  const count = (name: string) => {
    const match = output.match(new RegExp(`^# ${name} (\\d+)$`, "m"));
    if (!match) errors.push(`test runner omitted its ${name} summary`);
    return Number(match?.[1] ?? 0);
  };
  const tests = count("tests");

  if (error) errors.push(`test runner could not start: ${error.message}`);
  if (status !== 0) errors.push(`test runner exited with status ${status ?? "unknown"}`);
  if (tests === 0) errors.push("test runner reported zero tests");
  if (count("skipped") > 0) errors.push("test runner reported skipped tests");
  if (count("todo") > 0) errors.push("test runner reported TODO tests");
  if (count("fail") > 0) errors.push("test runner reported failed tests");
  const fileLevelTests = testFiles.filter((file) => output.includes(`# Subtest: ${file}`));
  if (fileLevelTests.length > 0) errors.push(`test runner reported test files with no tests: ${fileLevelTests.join(", ")}`);
  return errors;
}

export function runStrictTestGate(root = process.cwd(), databaseUrl = process.env.TEST_DATABASE_URL): void {
  const testDatabaseUrl = requireTestDatabaseUrl(databaseUrl);
  const testFiles = findServerTestFiles(join(root, "src"));
  if (testFiles.length === 0) throw new Error("test:ci found no source test files");
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...environment } = process.env;

  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--test", "--test-reporter=tap", ...testFiles.map((file) => relative(root, file))],
    { cwd: root, encoding: "utf8", env: { ...environment, TEST_DATABASE_URL: testDatabaseUrl } },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);

  const errors = assessTestProcess({
    status: result.status,
    output,
    error: result.error,
    testFiles: testFiles.map((file) => relative(root, file)),
  });
  if (errors.length > 0) throw new Error(`test:ci failed: ${errors.join("; ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runStrictTestGate();
