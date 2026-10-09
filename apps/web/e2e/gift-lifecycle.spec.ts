import { dirname, resolve } from "node:path";

import { uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  createMemoryBoxDraft,
  type E2eRecord,
  publishTypicalMemoryBox,
  withE2eDatabase,
} from "./support/gift-journey";
import { expect, test } from "./test";

/** What remains of a gift in the E2E database once its purge has run. */
async function purgeState(giftId: string) {
  return withE2eDatabase(async (database) => {
    const [gift, publications, revisions, liveAssets, tombstone, audit] = await Promise.all([
      database.collection<{ _id: string }>("gifts").countDocuments({ _id: giftId }),
      database.collection("giftPublications").countDocuments({ giftId }),
      database.collection("giftRevisions").countDocuments({ giftId }),
      database.collection("assets").countDocuments({ giftId, status: { $ne: "deleted" } }),
      database.collection<{ _id: string }>("giftTombstones").findOne({ _id: giftId }),
      database
        .collection<{ metadata: Record<string, unknown> }>("auditLog")
        .findOne({ action: "gift.deleted", "target.id": giftId }, { projection: { metadata: 1 } }),
    ]);
    return {
      audit: audit?.metadata ?? null,
      gift,
      liveAssets,
      publications,
      revisions,
      tombstoneKeys: tombstone ? Object.keys(tombstone).sort() : null,
    };
  });
}

async function cleanupPurge(giftId: string | undefined): Promise<void> {
  if (!giftId) return;
  await withE2eDatabase(async (database) => {
    await Promise.all([
      database.collection<{ _id: string }>("giftTombstones").deleteOne({ _id: giftId }),
      database.collection("auditLog").deleteMany({ "target.id": giftId }),
      database.collection("assets").deleteMany({ giftId }),
      database.collection("jobOutbox").deleteMany({ "payload.giftId": giftId }),
    ]);
  });
}

test("an owner pauses, resumes and deletes a published gift, which is purged to a tombstone", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  let record: E2eRecord | undefined;
  let giftId: string | undefined;
  page.on("dialog", (dialog) => void dialog.accept());

  try {
    const published = await publishTypicalMemoryBox(
      page,
      resolve(dirname(testInfo.file), "fixtures"),
      uniqueE2eEmail("lifecycle", testInfo),
    );
    record = published.record;
    giftId = published.giftId;
    const studioPath = `/studio/${published.record.publicId}`;

    // 1. Pause: the share link answers like an unknown one.
    await page.goto(studioPath);
    await page.getByRole("button", { name: "Tạm dừng chia sẻ" }).click();
    await expect(page.getByRole("heading", { name: "Đã tạm dừng chia sẻ" })).toBeVisible();
    const paused = await page.request.get(published.shareUrl);
    expect(paused.status()).toBe(404);

    // 2. Resume: the same link opens the gift again.
    await page.getByRole("button", { name: "Tiếp tục chia sẻ" }).click();
    await expect(page.getByRole("button", { name: "Tạm dừng chia sẻ" })).toBeVisible();
    const resumed = await page.request.get(published.shareUrl);
    expect(resumed.status()).toBe(200);

    // 3. Delete: confirmed, the link and the Studio are gone at once, and the purge leaves a
    // tombstone without content.
    await page.getByRole("button", { name: "Xoá món quà" }).click();
    await expect(page.getByRole("heading", { name: "Đã xoá món quà." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tạo món quà mới" })).toBeVisible();
    expect((await page.request.get(published.shareUrl)).status()).toBe(404);
    // The Studio streams (`loading.tsx`), so its not-found page arrives with HTTP 200.
    await page.goto(studioPath);
    await expect(page.getByRole("heading", { name: "Không mở được bản nháp này" })).toBeVisible();

    await expect
      .poll(() => purgeState(published.giftId), { timeout: 30_000 })
      .toEqual({
        audit: { photos: 3, published: true },
        gift: 0,
        liveAssets: 0,
        publications: 0,
        revisions: 0,
        tombstoneKeys: [
          "_id",
          "createdAt",
          "deletedAt",
          "deletionRequestedAt",
          "expiresAt",
          "ownerId",
          "publicId",
          "publishedAt",
        ],
      });
  } finally {
    await cleanupPurge(giftId);
    if (record) await cleanupE2eRecord(record);
  }
});

test("the browser of an anonymous draft deletes it", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  const publicId = await createMemoryBoxDraft(page);
  let giftId: string | undefined;
  try {
    giftId = await withE2eDatabase(
      async (database) =>
        (
          await database
            .collection<{ _id: string; publicId: string }>("gifts")
            .findOne({ publicId }, { projection: { _id: 1 } })
        )?._id,
    );

    await page.goto(`/studio/${publicId}`);
    await page.getByRole("button", { name: "Xoá món quà" }).click();

    await expect(page.getByRole("heading", { name: "Đã xoá món quà." })).toBeVisible();
    await page.goto(`/studio/${publicId}`);
    await expect(page.getByRole("heading", { name: "Không mở được bản nháp này" })).toBeVisible();
  } finally {
    await cleanupPurge(giftId);
    await cleanupE2eRecord({ publicId });
  }
});
