import { createHmac } from "node:crypto";
import { UUID } from "mongodb";

import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  createMemoryBoxDraft,
  MEMORY_BOX_CONTENT,
  withE2eDatabase,
} from "./support/gift-journey";
import { expect, test } from "./test";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("The setup key is not base32.");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as an authenticator app computes it from the setup key. */
function totp(setupKey: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", base32Decode(setupKey)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Sets the role directly in the E2E database; returns the user id as the application sees it. */
async function setRole(email: string, role: "admin" | "creator"): Promise<string> {
  return withE2eDatabase(async (database) => {
    const users = database.collection<{ _id: string | UUID; email: string }>("users");
    await users.updateOne({ email }, { $set: { role } });
    const user = await users.findOne({ email }, { projection: { _id: 1 } });
    if (!user) throw new Error("The E2E user does not exist.");
    // Better Auth stores user ids as BSON UUIDs.
    return user._id instanceof UUID ? user._id.toString() : String(user._id);
  });
}

/** Removes what the admin journey adds beyond a gift and its account. */
async function cleanupAdminRecords(userId: string | undefined, giftId: string | undefined) {
  if (!userId) return;
  await withE2eDatabase(async (database) => {
    await Promise.all([
      database.collection("twoFactors").deleteMany({ userId: { $in: [userId, new UUID(userId)] } }),
      database.collection("adminStepUps").deleteMany({ userId }),
      database.collection("auditLog").deleteMany({ "actor.id": userId }),
      ...(giftId ? [database.collection("auditLog").deleteMany({ "target.id": giftId })] : []),
    ]);
  });
}

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

    // 1. Without a factor the admin is sent to enrollment.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/mfa$/);
    await expect(page.getByRole("heading", { name: "Thiết lập xác thực hai lớp" })).toBeVisible();

    // 2. Enrollment shows the setup key and the backup codes once; a computed code activates it.
    await page.getByRole("button", { name: "Tạo mã thiết lập" }).click();
    const setup = page.getByRole("region", { name: "Thiết lập ứng dụng xác thực" });
    await expect(
      setup.getByText("Lưu các mã dự phòng ở nơi an toàn.", { exact: false }),
    ).toBeVisible();
    const setupKey = (await setup.locator("p.font-mono").first().textContent())?.trim() ?? "";
    expect(setupKey).toMatch(/^[A-Z2-7]+=*$/);
    await page.getByLabel("Mã xác thực").fill(totp(setupKey));
    await page.getByRole("button", { name: "Xác nhận" }).click();

    // 3. The admin reaches /admin; a lookup by publicId shows the summary and no gift text.
    await expect(page).toHaveURL(/\/admin$/);
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
    await cleanupAdminRecords(userId, giftId);
    if (publicId) await cleanupE2eRecord({ email, publicId });
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
