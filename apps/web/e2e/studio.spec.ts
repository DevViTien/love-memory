import { GiftDraftResponseSchema } from "@love-memory/contracts";
import { type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

import { expect, test } from "./test";

const createdPublicIds: string[] = [];

async function deleteDrafts(publicIds: readonly string[]) {
  const uri = process.env["MONGODB_URI"];
  const databaseName = process.env["MONGODB_DATABASE"];
  if (!uri || !databaseName) {
    throw new Error("E2E database cleanup requires MONGODB_URI and MONGODB_DATABASE.");
  }
  const client = await new MongoClient(uri).connect();
  try {
    const database = client.db(databaseName);
    for (const publicId of publicIds) {
      const gift = await database
        .collection<{ _id: string }>("gifts")
        .findOne({ publicId }, { projection: { _id: 1 } });
      if (!gift) continue;
      await Promise.all([
        database.collection("giftRevisions").deleteMany({ giftId: gift._id }),
        database.collection("idempotencyKeys").deleteMany({ giftId: gift._id }),
      ]);
      await database.collection("gifts").deleteOne({ publicId });
    }
  } finally {
    await client.close();
  }
}

test.afterEach(async () => {
  await deleteDrafts(createdPublicIds.splice(0));
});

/** Creates an anonymous `memory-box@1.1.0` draft owned by the page's browser context. */
async function createMemoryBoxDraft(page: Page): Promise<string> {
  await page.goto("/");
  const created = await page.evaluate(async (key) => {
    const response = await fetch("/api/gifts", {
      body: JSON.stringify({ templateId: "memory-box", templateVersion: "1.1.0" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      method: "POST",
    });
    return { body: (await response.json()) as unknown, status: response.status };
  }, randomUUID());
  expect(created.status).toBe(201);
  const body = created.body as { data?: unknown };
  const publicId = GiftDraftResponseSchema.parse(body.data).gift.publicId;
  createdPublicIds.push(publicId);
  return publicId;
}

function saveStatus(page: Page) {
  return page.getByRole("status").filter({ hasText: /Đã lưu|Đang lưu|Chưa lưu|Mất kết nối/ });
}

function stepNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Các bước tạo quà" });
}

test("moves between Studio steps with the URL and the browser's back action", async ({ page }) => {
  const publicId = await createMemoryBoxDraft(page);
  await page.goto(`/studio/${publicId}`);

  await expect(stepNavigation(page).getByRole("button")).toHaveCount(7);
  // "Step list on a phone": the step list scrolls within itself; the page never scrolls sideways.
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
  await page.locator("#studio-field-receiver-name").fill("Linh");
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page).toHaveURL(/\?step=opening$/);
  await expect(page.getByRole("heading", { name: "Lời mở hộp" })).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(/\?step=recipient$/);
  await expect(page.locator("#studio-field-receiver-name")).toHaveValue("Linh");
});

test("opens and focuses a field from a ?field= deep link", async ({ page }) => {
  const publicId = await createMemoryBoxDraft(page);

  await page.goto(`/studio/${publicId}?field=final-letter`);

  await expect(page.locator("#studio-field-final-letter")).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/studio/${publicId}\\?step=letter$`));
});

test("autosaves without a click and keeps the text after a reload", async ({ page }) => {
  const publicId = await createMemoryBoxDraft(page);
  await page.goto(`/studio/${publicId}`);
  await expect(saveStatus(page)).toHaveText("Đã lưu");

  await page.locator("#studio-field-receiver-name").fill("Người thương");
  await expect(saveStatus(page)).toHaveText("Đang lưu…");
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 10_000 });

  await page.reload();
  await expect(page.locator("#studio-field-receiver-name")).toHaveValue("Người thương");
  await expect(page.getByText(/Revision \d/)).toHaveCount(0);
});

test("waits while offline and saves when the connection returns", async ({ context, page }) => {
  const publicId = await createMemoryBoxDraft(page);
  await page.goto(`/studio/${publicId}`);
  await expect(saveStatus(page)).toHaveText("Đã lưu");

  await context.setOffline(true);
  await page.locator("#studio-field-receiver-name").fill("Linh");
  await expect(saveStatus(page)).toHaveText("Mất kết nối — sẽ lưu khi có mạng", {
    timeout: 10_000,
  });

  await context.setOffline(false);
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 10_000 });
  await page.reload();
  await expect(page.locator("#studio-field-receiver-name")).toHaveValue("Linh");
});

test("resolves a two-tab revision conflict explicitly", async ({ context, page }) => {
  const publicId = await createMemoryBoxDraft(page);
  const tabB = await context.newPage();
  await page.goto(`/studio/${publicId}`);
  await tabB.goto(`/studio/${publicId}`);
  const name = (target: Page) => target.locator("#studio-field-receiver-name");

  // A person edits the tab in front of them. Real Chrome throttles animation frames in a background
  // tab, which would stall Playwright's actions until the 1.5 s autosave has already sent the edit.
  // Tab A saves first; tab B's next save conflicts and keeps its edits on screen.
  await page.bringToFront();
  await name(page).fill("Tab A");
  await page.getByRole("button", { name: "Lưu ngay" }).click();
  await expect(saveStatus(page)).toHaveText("Đã lưu");
  await tabB.bringToFront();
  await name(tabB).fill("Tab B");
  await tabB.getByRole("button", { name: "Lưu ngay" }).click();
  const banner = tabB.getByRole("alert").filter({ hasText: "Bản nháp đã được lưu ở nơi khác" });
  await expect(banner).toContainText("(phiên bản 1)");
  await expect(name(tabB)).toHaveValue("Tab B");

  await tabB.getByRole("button", { name: "Giữ bản của tôi" }).click();
  await expect(banner).toHaveCount(0);
  await expect(saveStatus(tabB)).toHaveText("Đã lưu");

  // Now tab A is stale; it loads the stored version instead.
  await page.bringToFront();
  await name(page).fill("Tab A lần hai");
  await page.getByRole("button", { name: "Lưu ngay" }).click();
  const bannerA = page.getByRole("alert").filter({ hasText: "Bản nháp đã được lưu ở nơi khác" });
  await expect(bannerA).toContainText("(phiên bản 2)");
  await page.getByRole("button", { name: "Tải bản mới nhất" }).click();
  await expect(bannerA).toHaveCount(0);
  await expect(name(page)).toHaveValue("Tab B");
  await expect(saveStatus(page)).toHaveText("Đã lưu");
});
