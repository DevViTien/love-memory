import { type BrowserContext, test as base } from "@playwright/test";
import { randomInt } from "node:crypto";

export { expect } from "@playwright/test";

/**
 * Sends a distinct private client address on the context's auth requests. Every context a test
 * creates itself (`browser.newContext()`) needs it too, or it shares the server's one bucket.
 */
export async function assignOwnAuthClientAddress(context: BrowserContext): Promise<void> {
  const clientIp = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  await context.route("**/api/auth/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-forwarded-for": clientIp },
    }),
  );
}

/**
 * Playwright `test` whose browser context acts as its own client for auth rate limiting.
 *
 * Better Auth keys its per-IP limits (`/api/auth/*`, 60 requests per rolling 60 s) on
 * `x-forwarded-for`, which Vercel sets for every real visitor. The local `next start` server gets no
 * such header, so every E2E browser shared one bucket and the suite's header `get-session` calls
 * alone exceeded it. Each test context now sends a distinct private address on auth requests only;
 * the production limits themselves are unchanged.
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await assignOwnAuthClientAddress(context);
    await provide(context);
  },
});
