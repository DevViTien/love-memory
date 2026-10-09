import { type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import { cleanupE2eRecord, type E2eRecord, publishTypicalMemoryBox } from "./support/gift-journey";
import { assignOwnAuthClientAddress, expect, test } from "./test";

type Probe = Readonly<{
  body?: unknown;
  headers?: Record<string, string>;
  method: string;
  path: string;
}>;

/** Runs a request from inside the page, as the Studio does (the session cookie is `Secure`). */
async function call(page: Page, probe: Probe): Promise<number> {
  return page.evaluate(async ({ body, headers, method, path }) => {
    const response = await fetch(path, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      method,
    });
    return response.status;
  }, probe);
}

test("a second signed-in user gets the same not-found for every owner route of another user's gift", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  let record: E2eRecord | undefined;
  const intruderEmail = uniqueE2eEmail("intruder", testInfo);
  const intruderContext = await browser.newContext();
  await assignOwnAuthClientAddress(intruderContext);

  try {
    const published = await publishTypicalMemoryBox(
      page,
      resolve(dirname(testInfo.file), "fixtures"),
      uniqueE2eEmail("victim", testInfo),
    );
    record = published.record;
    const publicId = published.record.publicId;

    const intruder = await intruderContext.newPage();
    await intruder.goto("/auth/sign-in");
    await signInThroughMagicLink(intruder, intruderEmail);

    const probes: Probe[] = [
      { method: "GET", path: `/api/gifts/${publicId}` },
      {
        body: { content: {}, expectedRevision: 0 },
        method: "PATCH",
        path: `/api/gifts/${publicId}`,
      },
      { body: {}, method: "POST", path: `/api/gifts/${publicId}/preview` },
      { body: {}, method: "POST", path: `/api/gifts/${publicId}/claim` },
      {
        body: { expectedRevision: 0, planId: "free", rightsConfirmed: true },
        headers: { "Idempotency-Key": randomUUID() },
        method: "POST",
        path: `/api/gifts/${publicId}/publish`,
      },
      { body: {}, method: "POST", path: `/api/gifts/${publicId}/pause` },
      { body: {}, method: "POST", path: `/api/gifts/${publicId}/resume` },
      { body: {}, method: "POST", path: `/api/gifts/${publicId}/delete` },
      { method: "GET", path: `/api/gifts/${publicId}/export` },
      { method: "GET", path: `/api/media/assets?giftPublicId=${publicId}` },
    ];
    for (const probe of probes) {
      expect({
        path: probe.path,
        method: probe.method,
        status: await call(intruder, probe),
      }).toEqual({
        method: probe.method,
        path: probe.path,
        status: 404,
      });
    }

    await intruder.goto(`/studio/${publicId}`);
    await expect(
      intruder.getByRole("heading", { name: "Không mở được bản nháp này" }),
    ).toBeVisible();

    // The owner's gift is untouched.
    expect((await page.request.get(published.shareUrl)).status()).toBe(200);
  } finally {
    await intruderContext.close();
    if (record) await cleanupE2eRecord(record);
    await cleanupE2eRecord({ email: intruderEmail, publicId: "none" });
  }
});
