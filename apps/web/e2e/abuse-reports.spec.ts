import { type Browser, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";

import { cleanupAdminAccount, signInAsSteppedUpAdmin } from "./support/admin";
import { uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  type E2eRecord,
  MEMORY_BOX_CONTENT,
  publishTypicalMemoryBox,
  withE2eDatabase,
} from "./support/gift-journey";
import { assignOwnAuthClientAddress, expect, test } from "./test";

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await assignOwnAuthClientAddress(context);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  return page;
}

async function report(page: Page, shareUrl: string, label: string): Promise<void> {
  await page.goto(shareUrl);
  await page.getByRole("button", { name: "Báo cáo nội dung" }).click();
  await page.getByLabel(label).check();
  await page.getByRole("button", { name: "Gửi báo cáo" }).click();
  await expect(page.getByText("Cảm ơn bạn. Chúng tôi sẽ xem xét báo cáo này.")).toBeVisible();
}

async function cleanupModeration(giftId: string | undefined): Promise<void> {
  if (!giftId) return;
  await withE2eDatabase(async (database) => {
    await Promise.all([
      database.collection("abuseReports").deleteMany({ giftId }),
      database.collection("auditLog").deleteMany({ "target.id": giftId }),
    ]);
  });
}

test("a recipient reports a gift, an admin reviews it, takes it down and restores it", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const adminEmail = uniqueE2eEmail("moderator", testInfo);
  let record: E2eRecord | undefined;
  let giftId: string | undefined;
  let adminId: string | undefined;

  try {
    const published = await publishTypicalMemoryBox(
      page,
      resolve(dirname(testInfo.file), "fixtures"),
      uniqueE2eEmail("reported-owner", testInfo),
    );
    record = published.record;
    giftId = published.giftId;

    // 1. A recipient reports it.
    const recipient = await newPage(browser);
    await report(recipient, published.shareUrl, "Quấy rối hoặc lăng mạ");

    // 2. An admin reviews the reported content (audited) and takes the gift down.
    const admin = await newPage(browser);
    adminId = await signInAsSteppedUpAdmin(admin, adminEmail);
    await admin.goto("/admin/reports");
    const item = admin.getByRole("listitem").filter({ hasText: published.record.publicId });
    await expect(item).toContainText("Quấy rối hoặc lăng mạ");
    await item.getByRole("link", { name: "Xem nội dung" }).click();
    await expect(admin.getByRole("heading", { name: "Xem báo cáo" })).toBeVisible();
    const reviewUrl = admin.url();
    await expect(
      admin
        .getByRole("region", { name: "Nội dung bị báo cáo" })
        .getByText(MEMORY_BOX_CONTENT.receiver),
    ).toBeVisible();
    await admin.getByRole("button", { name: "Gỡ món quà" }).click();
    await expect(admin.getByText("actioned")).toBeVisible();

    // 3. The link is not-found, and the owner sees the takedown notice with delete only.
    expect((await recipient.request.get(published.shareUrl)).status()).toBe(404);
    await page.goto(`/studio/${published.record.publicId}`);
    await expect(page.getByRole("heading", { name: "Món quà đã bị tạm khoá" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tiếp tục chia sẻ" })).toHaveCount(0);

    // 4. The admin restores; the link opens again, and every step is in the audit log.
    await admin.goto(reviewUrl);
    await admin.getByRole("button", { name: "Khôi phục" }).click();
    await expect
      .poll(async () => (await recipient.request.get(published.shareUrl)).status())
      .toBe(200);

    await admin.goto(`/admin/audit?target=${giftId}`);
    const rows = admin.getByRole("row");
    // Every render of the review page is recorded, the refreshes after each action included.
    await expect
      .poll(() => rows.filter({ hasText: "admin.gift.content_viewed" }).count())
      .toBeGreaterThanOrEqual(1);
    await expect(rows.filter({ hasText: "admin.gift.taken_down" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "admin.gift.restored" })).toHaveCount(1);
    await recipient.context().close();
    await admin.context().close();
  } finally {
    await cleanupModeration(giftId);
    await cleanupAdminAccount(adminEmail, adminId);
    if (record) await cleanupE2eRecord(record);
  }
});

test("a critical report takes the gift down at once", async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000);
  let record: E2eRecord | undefined;
  let giftId: string | undefined;

  try {
    const published = await publishTypicalMemoryBox(
      page,
      resolve(dirname(testInfo.file), "fixtures"),
      uniqueE2eEmail("critical-owner", testInfo),
    );
    record = published.record;
    giftId = published.giftId;

    const recipient = await newPage(browser);
    await report(recipient, published.shareUrl, "Xâm hại trẻ em");

    expect((await recipient.request.get(published.shareUrl)).status()).toBe(404);
    const takedown = await withE2eDatabase((database) =>
      database
        .collection<{ _id: string; takedown?: { by: string; reason: string } }>("gifts")
        .findOne({ _id: published.giftId }, { projection: { takedown: 1 } }),
    );
    expect(takedown?.takedown).toMatchObject({ by: "system", reason: "child_safety" });
    await recipient.context().close();
  } finally {
    await cleanupModeration(giftId);
    if (record) await cleanupE2eRecord(record);
  }
});
