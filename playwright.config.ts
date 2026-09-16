import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = "http://127.0.0.1:" + port;

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "installed-chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm --filter @love-memory/web start --port " + port,
    env: {
      TECHNICAL_SPIKES_ENABLED: "true",
      TECHNICAL_SPIKE_TOKEN: "playwright-technical-spike-token",
    },
    reuseExistingServer: false,
    timeout: 180000,
    url: baseURL,
  },
});
