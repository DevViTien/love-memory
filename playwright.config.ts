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
      AUTH_EMAIL_FROM: process.env["AUTH_EMAIL_FROM"] ?? "LoveMemory <hello@example.com>",
      BETTER_AUTH_SECRET:
        process.env["BETTER_AUTH_SECRET"] ?? "playwright-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: process.env["BETTER_AUTH_URL"] ?? baseURL,
      RESEND_API_KEY: process.env["RESEND_API_KEY"] ?? "re_playwright_not_used",
      TECHNICAL_SPIKES_ENABLED: "true",
      TECHNICAL_SPIKE_TOKEN: "playwright-technical-spike-token",
    },
    reuseExistingServer: false,
    timeout: 180000,
    url: baseURL,
  },
});
