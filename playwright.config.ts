import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Intentionally local-only: never reuse a signed-in or production server.
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/mobile",
  outputDir: isCi
    ? "test-results/playwright"
    : process.env.MOBILE_TEST_OUTPUT ?? join(tmpdir(), "system-mobile-tests"),
  timeout: 20_000,
  expect: { timeout: 3_000 },
  fullyParallel: true,
  workers: 2,
  reporter: isCi
    ? [
        ["list"],
        ["json", { outputFile: "playwright-report/results.json" }],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : "list",
  use: {
    baseURL: "http://127.0.0.1:3217",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    { name: "phone-320", use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "phone-390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: process.env.MOBILE_TEST_SERVER === "production"
      ? "npm run start -- --hostname 127.0.0.1 --port 3217"
      : "npm run dev -- --hostname 127.0.0.1 --port 3217",
    url: "http://127.0.0.1:3217",
    reuseExistingServer: false,
    env: {
      AUTH0_DOMAIN: "", AUTH0_CLIENT_ID: "", AUTH0_CLIENT_SECRET: "", AUTH0_SECRET: "",
      DATABASE_URL: "", BLOB_READ_WRITE_TOKEN: "", SYSTEM_DEMO_MODE: "false",
    },
  },
});
