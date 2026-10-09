import { dirname, resolve } from "node:path";

import { uniqueE2eEmail } from "./support/auth";
import { cleanupE2eRecord, type E2eRecord, publishTypicalMemoryBox } from "./support/gift-journey";
import { expect, test } from "./test";

test("the privacy notice is one footer link away, without an account", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Quyền riêng tư" }).click();

  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Chính sách quyền riêng tư" })).toBeVisible();
  await expect(page.getByText("Xoá trong vài phút sau khi cập nhật.")).toBeVisible();
  await expect(page.getByText(/Không có cookie quảng cáo/)).toBeVisible();

  await page.goto("/auth/sign-in");
  await expect(page.getByRole("link", { name: "Chính sách quyền riêng tư" })).toHaveAttribute(
    "href",
    "/privacy",
  );
});

test("the owner exports a published gift as JSON without storage keys", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  let record: E2eRecord | undefined;
  try {
    const published = await publishTypicalMemoryBox(
      page,
      resolve(dirname(testInfo.file), "fixtures"),
      uniqueE2eEmail("exporter", testInfo),
    );
    record = published.record;

    await page.goto(`/studio/${published.record.publicId}`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Tải dữ liệu món quà" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`love-memory-${published.record.publicId}.json`);

    // From inside the page: the session cookie is `Secure`, as for every owner call.
    const result = await page.evaluate(async (path) => {
      const response = await fetch(path);
      return { body: (await response.json()) as unknown, status: response.status };
    }, `/api/gifts/${published.record.publicId}/export`);
    expect(result.status).toBe(200);
    const exported = result.body as {
      content: Record<string, unknown>;
      photos: { url: string }[];
      publication: { sharePath: string } | null;
    };
    expect(exported.publication?.sharePath).toBe(new URL(published.shareUrl).pathname);
    expect(exported.photos).toHaveLength(3);
    expect(JSON.stringify(exported)).not.toMatch(/sourceKey|"key"|claimToken/);

    const stranger = await page.context().browser()!.newContext();
    const refused = await stranger.request.get(
      new URL(`/api/gifts/${published.record.publicId}/export`, page.url()).href,
    );
    expect(refused.status()).toBe(404);
    await stranger.close();
  } finally {
    if (record) await cleanupE2eRecord(record);
  }
});
