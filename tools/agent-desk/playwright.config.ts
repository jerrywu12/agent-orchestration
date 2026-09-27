import { defineConfig } from "@playwright/test";
const port = process.env.AGENT_DESK_E2E_PORT ?? "4318";
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "browser.spec.ts",
    "machine-browser.spec.ts",
    "intake-browser.spec.ts",
    "markdown-browser.spec.ts",
    "workflow-browser.spec.ts",
    "recovery-browser.spec.ts",
    "planning-ready.spec.ts",
    "archive-done.spec.ts",
    "bulk-planning.spec.ts",
    "activity-browser.spec.ts",
  ],
  workers: 1,
  timeout: 30000,
  expect: { timeout: 7000 },
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.CI ? undefined : "chrome",
    trace: "off",
    screenshot: "off",
  },
  webServer: {
    command: "node tests/serve-e2e.mjs",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: [["list"]],
});
