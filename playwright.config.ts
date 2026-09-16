import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const port = 3100;
const baseURL = "http://127.0.0.1:" + port;
const authCapturePath = resolve(
  process.env["AUTH_EMAIL_CAPTURE_PATH"] ?? ".tmp/e2e-auth-emails.jsonl",
);
const configuredDatabase = process.env["MONGODB_DATABASE"] ?? "love_memory";
const e2eDatabase = configuredDatabase.endsWith("_e2e")
  ? configuredDatabase
  : `${configuredDatabase}_e2e`;
process.env["MONGODB_DATABASE"] = e2eDatabase;

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
    command: "pnpm db:seed && pnpm build && pnpm --filter @love-memory/web start --port " + port,
    env: {
      AUTH_EMAIL_CAPTURE_PATH: authCapturePath,
      AUTH_EMAIL_FROM: process.env["AUTH_EMAIL_FROM"] ?? "LoveMemory <hello@example.com>",
      BETTER_AUTH_SECRET:
        process.env["BETTER_AUTH_SECRET"] ?? "playwright-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: process.env["BETTER_AUTH_URL"] ?? baseURL,
      MONGODB_DATABASE: e2eDatabase,
      RESEND_API_KEY: process.env["RESEND_API_KEY"] ?? "re_playwright_not_used",
      TECHNICAL_SPIKES_ENABLED: "true",
      TECHNICAL_SPIKE_TOKEN: "playwright-technical-spike-token",
    },
    reuseExistingServer: false,
    timeout: 180000,
    url: baseURL,
  },
});
