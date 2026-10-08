import { type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { dirname, resolve } from "node:path";

import { deleteAnalyticsEvents, giftRefOf } from "./support/analytics";
import { uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  type E2eRecord,
  listDraftAssetIds,
  publishTypicalMemoryBox,
  saveStatus,
  studioStep,
  TYPICAL_MEMORY_BOX,
  waitForHydration,
} from "./support/gift-journey";
import { assignOwnAuthClientAddress, expect, test } from "./test";

// Edit after publish (`change-gift-publication-revisions`): the owner keeps editing a published
// gift, recipients keep the current publication until `Cập nhật món quà`, and the share link never
// changes. Needs INTERNAL_PUBLISH_ENABLED=true and local object storage on the web server.

test.use({ actionTimeout: 20_000 });

const records: E2eRecord[] = [];
const giftRefs: string[] = [];

test.afterEach(async () => {
  await Promise.all(records.splice(0).map((record) => cleanupE2eRecord(record)));
  await deleteAnalyticsEvents(giftRefs.splice(0));
});

type RecipientPayload = Readonly<{
  assets: Readonly<Record<string, unknown>>;
  payload: Readonly<Record<string, unknown>>;
}>;

async function publishGift(page: Page, testInfo: TestInfo) {
  const published = await publishTypicalMemoryBox(
    page,
    resolve(dirname(testInfo.file), "fixtures"),
    uniqueE2eEmail("publish-update", testInfo),
  );
  records.push(published.record);
  giftRefs.push(giftRefOf(published.giftId));
  return { ...published, shareId: published.shareUrl.slice(-22) };
}

/** A recipient without the owner's cookies, on the share link's own origin. */
async function openRecipient(page: Page, shareUrl: string): Promise<BrowserContext> {
  const browser = page.context().browser();
  if (!browser) throw new Error("A browser is required for a recipient context.");
  const context = await browser.newContext();
  await assignOwnAuthClientAddress(context);
  const guest = await context.newPage();
  const response = await guest.goto(shareUrl);
  expect(response?.status()).toBe(200);
  return context;
}

/** What `Mở quà` would load for the recipient: the current publication's viewer payload. */
async function recipientPayload(context: BrowserContext, shareId: string) {
  const guest = context.pages()[0]!;
  const loaded = await guest.evaluate(async (id) => {
    const response = await fetch(`/api/public-gifts/${id}`, { cache: "no-store" });
    return {
      body: (await response.json()) as { data?: { viewer: unknown } },
      status: response.status,
    };
  }, shareId);
  expect(loaded.status).toBe(200);
  return loaded.body.data?.viewer as RecipientPayload;
}

async function updateFromStudio(page: Page) {
  await studioStep(page, /Xuất bản/).click();
  const publishRegion = page.getByRole("region", { name: "Xuất bản" });
  const update = publishRegion.getByRole("button", { name: "Cập nhật món quà" });
  await waitForHydration(update);
  await expect(update).toBeEnabled();
  await update.click();
  await expect(
    publishRegion.getByRole("heading", { name: "Cập nhật món quà đã gửi?" }),
  ).toBeFocused();
  await publishRegion.getByRole("button", { name: "Xác nhận cập nhật" }).click();
  await expect(publishRegion.getByText("Đã cập nhật món quà.")).toBeVisible();
  await expect(page.getByText("Người nhận đang xem bản mới nhất.", { exact: true })).toBeVisible();
  return publishRegion;
}

test("an edited published gift reaches recipients only after Cập nhật món quà, at the same link", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const { record, shareId, shareUrl } = await publishGift(page, testInfo);
  const newLetter = "Lá thư đã sửa sau khi gửi ✉️";

  // The Studio of a published gift: the published panel above the editor.
  await page.goto(`/studio/${record.publicId}?field=final-letter`);
  await expect(page.getByRole("heading", { name: "Đã xuất bản" })).toBeVisible();
  await expect(page.getByText("Người nhận đang xem bản mới nhất.", { exact: true })).toBeVisible();
  const letter = page.getByRole("textbox", { name: "Lá thư cuối" });
  await expect(letter).toBeFocused();
  await letter.fill(newLetter);
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 15_000 });
  await expect(
    page.getByText("Có thay đổi chưa cập nhật. Người nhận vẫn đang xem bản đã gửi trước đó."),
  ).toBeVisible();

  // Edit not visible to recipients.
  const recipient = await openRecipient(page, shareUrl);
  try {
    const before = await recipientPayload(recipient, shareId);
    expect(before.payload["final-letter"]).toBe(TYPICAL_MEMORY_BOX.letter);

    // Update visible at the same link.
    const publishRegion = await updateFromStudio(page);
    const after = await recipientPayload(recipient, shareId);
    expect(after.payload["final-letter"]).toBe(newLetter);
    await expect(page.getByRole("textbox", { name: "Đường dẫn món quà" })).toHaveValue(shareUrl);

    // Nothing to update.
    await expect(publishRegion.getByRole("button", { name: "Cập nhật món quà" })).toBeDisabled();
    await expect(
      publishRegion.getByText(
        "Người nhận đang xem bản mới nhất. Hãy chỉnh sửa trước khi cập nhật.",
      ),
    ).toBeVisible();
  } finally {
    await recipient.close();
  }
});

test("a photo of the live publication stays with recipients until the update replaces it", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const { record, shareId, shareUrl } = await publishGift(page, testInfo);
  await page.goto(`/studio/${record.publicId}`);
  const original = await listDraftAssetIds(page, record.publicId);
  expect(original).toHaveLength(3);
  const removed = original[0]!;

  // Photo removed from the working copy: detached (`deleted: false`), never deleted.
  await studioStep(page, /Kỷ niệm/).click();
  const photos = page.locator('img[alt="Ảnh kỷ niệm đã tải"][src*="/api/local-object-storage/"]');
  await expect(photos).toHaveCount(3, { timeout: 45_000 });
  const deletion = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/media/assets/${removed}`) &&
      response.request().method() === "DELETE",
  );
  const memories = page.getByRole("region", { name: "Kỷ niệm" });
  await waitForHydration(memories.getByRole("button", { name: "Xóa" }).first());
  await memories.getByRole("button", { name: "Xóa" }).first().click();
  // `200` with `deleted: false` (asserted by the API step of `publish.spec.ts`); that the objects
  // stay is shown below by the recipient, who still receives the photo.
  expect((await deletion).status()).toBe(200);
  await expect(photos).toHaveCount(2);

  // Replacing a published photo in a full field: the detached photo frees its slot.
  const picker = page.locator('input#studio-field-memories[type="file"]');
  await expect(picker).toBeEnabled();
  await picker.setInputFiles(resolve(dirname(testInfo.file), "fixtures", "photo.jpg"));
  await page
    .getByRole("dialog", { name: "Cắt ảnh theo khung mẫu quà" })
    .getByRole("button", { name: "Dùng vùng ảnh này" })
    .click();
  await expect(photos).toHaveCount(3, { timeout: 45_000 });
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 15_000 });
  const working = await listDraftAssetIds(page, record.publicId);
  expect(working).not.toContain(removed);
  const replacement = working.find((assetId) => !original.includes(assetId));
  expect(replacement).toBeDefined();

  const recipient = await openRecipient(page, shareUrl);
  try {
    // Removed photo still shown to recipients.
    const before = await recipientPayload(recipient, shareId);
    expect(Object.keys(before.assets).sort()).toEqual([...original].sort());

    await updateFromStudio(page);
    const after = await recipientPayload(recipient, shareId);
    expect(Object.keys(after.assets)).toContain(replacement);
    expect(Object.keys(after.assets)).not.toContain(removed);
  } finally {
    await recipient.close();
  }
});
