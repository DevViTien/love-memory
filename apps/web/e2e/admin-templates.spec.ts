import { randomUUID } from "node:crypto";

import { cleanupAdminAccount, setRole, signInAsSteppedUpAdmin } from "./support/admin";
import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import { withE2eDatabase } from "./support/gift-journey";
import { expect, test } from "./test";

/**
 * A version only this test knows about: no `templates` document points to it, so the catalog and
 * every parallel test ignore it.
 */
async function insertTestVersion(templateId: string): Promise<void> {
  await withE2eDatabase(async (database) => {
    const now = new Date();
    await database
      .collection<Record<string, unknown> & { _id: string }>("templateVersions")
      .insertOne({
        _id: `${templateId}@1.0.0`,
        contentHash: "0".repeat(64),
        createdAt: now,
        manifest: {},
        status: "published",
        templateId,
        updatedAt: now,
        version: "1.0.0",
      });
  });
}

test("an admin kills a template version with a reason and restores it, both audited", async ({
  page,
}, testInfo) => {
  const email = uniqueE2eEmail("admin-templates", testInfo);
  const templateId = `e2e-kill-${randomUUID().slice(0, 8)}`;
  const versionId = `${templateId}@1.0.0`;
  let userId: string | undefined;
  page.on("dialog", (dialog) => void dialog.accept());

  try {
    await insertTestVersion(templateId);
    userId = await signInAsSteppedUpAdmin(page, email);

    await page
      .getByRole("navigation", { name: "Quản trị" })
      .getByRole("link", { name: "Mẫu quà" })
      .click();
    await expect(page).toHaveURL(/\/admin\/templates$/);
    const row = page.getByRole("row").filter({ hasText: versionId });
    await expect(row).toContainText("Đang phát hành");
    await expect(row).toContainText("Chưa có");

    await row.getByLabel("Lý do tắt").selectOption("legal");
    await row.getByRole("button", { name: "Tắt khẩn cấp" }).click();
    await expect(row).toContainText("Đã tắt (legal)");
    await expect(row).toContainText("Đã ngừng");
    await expect(row.getByRole("button", { name: "Tắt khẩn cấp" })).toHaveCount(0);

    await row.getByRole("button", { name: "Khôi phục" }).click();
    await expect(row.getByRole("button", { name: "Tắt khẩn cấp" })).toBeVisible();
    await expect(row).not.toContainText("Đã tắt");
    await expect(row).toContainText("Đã ngừng");

    await page.goto(`/admin/audit?target=${encodeURIComponent(versionId)}`);
    const records = page.getByRole("row");
    await expect(records.filter({ hasText: "admin.template.killed" })).toContainText(
      "reason=legal",
    );
    await expect(records.filter({ hasText: "admin.template.restored" })).toHaveCount(1);
    await expect(records.filter({ hasText: `template-version:${versionId}` })).toHaveCount(2);
  } finally {
    await withE2eDatabase((database) =>
      database.collection<{ _id: string }>("templateVersions").deleteOne({ _id: versionId }),
    );
    await cleanupAdminAccount(email, userId, [versionId]);
  }
});

test("a creator gets the not-found page and route on template controls", async ({
  page,
}, testInfo) => {
  const email = uniqueE2eEmail("creator-templates", testInfo);
  let userId: string | undefined;
  try {
    await page.goto("/auth/sign-in?next=/studio/new");
    await signInThroughMagicLink(page, email);
    userId = await setRole(email, "creator");

    const response = await page.goto("/admin/templates");
    expect(response?.status()).toBe(404);
    const action = await page.request.post("/api/admin/template-versions", {
      data: { action: "retire", templateId: "memory-box", version: "1.1.0" },
    });
    expect(action.status()).toBe(404);
  } finally {
    await cleanupAdminAccount(email, userId);
  }
});
