import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "browser.spec.ts",
    "machine-browser.spec.ts",
    "intake-browser.spec.ts",
  ],
  workers: 1,
  timeout: 30000,
  expect: { timeout: 7000 },
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4318",
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/serve-e2e.mjs",
    url: "http://127.0.0.1:4318/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: [["list"]],
});
