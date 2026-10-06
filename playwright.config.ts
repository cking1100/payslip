import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  globalTeardown: "./e2e/teardown.ts",
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3107", headless: true, trace: "off" },
  reporter: "list",
  webServer: {
    command: "npm run build:e2e && node scripts/test-server.mjs",
    url: "http://127.0.0.1:3107/api/data",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
