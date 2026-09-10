import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
dotenv.config({ path: ".env.group-photo-test.local", quiet: true });

// This suite intentionally fails rather than silently skipping real acceptance.
if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("Real group-photo acceptance is blocked: OPENAI_API_KEY is not configured. No provider call was made.");
const database = process.env.GROUP_PHOTO_TEST_DATABASE_URL;
if (!database) throw new Error("GROUP_PHOTO_TEST_DATABASE_URL must name a dedicated local test database.");
const url = new URL(database);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_test")) throw new Error("Real photo tests require a local database whose name ends in _test; production databases are prohibited.");
url.searchParams.set("options", "-c search_path=group_photo_finish_e2e,public");
process.env.GROUP_PHOTO_TEST_CONNECTION = url.toString();
export default defineConfig({
  testDir: "./tests/real", testMatch: "group-photo-generation.spec.ts", globalSetup: "./tests/real/group-photo-setup.ts",
  timeout: 360_000, expect: { timeout: 10_000 }, workers: 1, retries: 0,
  outputDir: "test-results/group-photo-real", reporter: "list",
  use: { baseURL: "http://127.0.0.1:3221", browserName: "chromium", viewport: { width: 1440, height: 1100 }, extraHTTPHeaders: { "x-system-demo": "local" }, serviceWorkers: "block", trace: "off" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3221", url: "http://127.0.0.1:3221", reuseExistingServer: false,
    env: { DATABASE_URL: url.toString(), SYSTEM_DEMO_MODE: "true", SYSTEM_E2E_TEST_MODE: "false", BLOB_READ_WRITE_TOKEN: "", AUTH0_DOMAIN: "", AUTH0_CLIENT_ID: "", AUTH0_CLIENT_SECRET: "", AUTH0_SECRET: "", SYSTEM_PUBLIC_ORIGIN: "http://127.0.0.1:3221" },
  },
});
