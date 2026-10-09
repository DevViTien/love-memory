import { cleanupAdminAccount, enrollAdminFactor, setRole } from "./support/admin";
import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  createMemoryBoxDraft,
  MEMORY_BOX_CONTENT,
  withE2eDatabase,
} from "./support/gift-journey";
import { expect, test } from "./test";

test("an admin enrolls, steps up, looks up a gift without its content and finds the lookup in the audit log", async ({
  page,
}, testInfo) => {
  const email = uniqueE2eEmail("admin", testInfo);
  let publicId: string | undefined;
  let userId: string | undefined;
  let giftId: string | undefined;

  try {
    await page.goto("/auth/sign-in?next=/admin");
    await signInThroughMagicLink(page, email);
    // Still a creator: the admin area does not exist for them.
    const asCreator = await page.goto("/admin");
    expect(asCreator?.status()).toBe(404);

    const draftPublicId = await createMemoryBoxDraft(page);
    publicId = draftPublicId;
    userId = await setRole(email, "admin");
    giftId = await withE2eDatabase(async (database) => {
      const gifts = database.collection<{ _id: string; publicId: string }>("gifts");
      await gifts.updateOne(
        { publicId: draftPublicId },
        { $set: { "content.data.receiver": MEMORY_BOX_CONTENT.receiver } },
      );
      return (await gifts.findOne({ publicId: draftPublicId }, { projection: { _id: 1 } }))?._id;
    });

    // 1–2. Without a factor the admin is sent to enrollment; a computed code activates it.
    await enrollAdminFactor(page);

    // 3. The admin reaches /admin; a lookup by publicId shows the summary and no gift text.
    await page.getByLabel("Tìm món quà").fill(draftPublicId);
    await page.getByRole("button", { name: "Tìm" }).click();
    const summary = page.getByRole("region", { name: "Món quà" });
    await expect(summary.getByText(draftPublicId, { exact: true })).toBeVisible();
    await expect(summary.getByText("draft", { exact: true })).toBeVisible();
    await expect(summary.getByText(`${email} (${userId})`)).toBeVisible();
    await expect(page.getByText(MEMORY_BOX_CONTENT.receiver)).toHaveCount(0);

    await page.getByLabel("Tìm món quà").fill("no-such-gift-value");
    await page.getByRole("button", { name: "Tìm" }).click();
    await expect(page.getByText("Không tìm thấy món quà nào.")).toBeVisible();

    // The audit page lists the lookup with the gift's internal id, never the searched text.
    await page.goto(`/admin/audit?target=${giftId}`);
    const rows = page.getByRole("row");
    await expect(rows.filter({ hasText: "admin.gift.looked_up" })).toHaveCount(1);
    await expect(rows.filter({ hasText: `gift:${giftId}` })).toHaveCount(1);
    await page.goto("/admin/audit");
    // Parallel projects share the E2E database: count only this admin's records.
    await expect(
      rows.filter({ hasText: "admin.mfa.enrolled" }).filter({ hasText: `admin:${userId}` }),
    ).toHaveCount(1);
    await expect(page.getByText("no-such-gift-value")).toHaveCount(0);

    // The plugin's own endpoints are unreachable, even for this signed-in admin.
    const enable = await page.request.post("/api/auth/two-factor/enable", { data: {} });
    expect(enable.status()).toBe(404);
  } finally {
    if (publicId) await cleanupE2eRecord({ email, publicId });
    await cleanupAdminAccount(email, userId, giftId ? [giftId] : []);
  }
});

test("a signed-out browser gets the not-found page on the admin area", async ({ page }) => {
  for (const path of ["/admin", "/admin/audit", "/admin/mfa"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
  const enroll = await page.request.post("/api/admin/mfa/enroll", { data: {} });
  expect(enroll.status()).toBe(404);
});
