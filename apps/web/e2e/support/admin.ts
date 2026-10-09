import { expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { UUID } from "mongodb";

import { signInThroughMagicLink } from "./auth";
import { withE2eDatabase } from "./gift-journey";

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
export function totp(setupKey: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", base32Decode(setupKey)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Sets the role directly in the E2E database; returns the user id as the application sees it. */
export async function setRole(email: string, role: "admin" | "creator"): Promise<string> {
  return withE2eDatabase(async (database) => {
    const users = database.collection<{ _id: string | UUID; email: string }>("users");
    await users.updateOne({ email }, { $set: { role } });
    const user = await users.findOne({ email }, { projection: { _id: 1 } });
    if (!user) throw new Error("The E2E user does not exist.");
    // Better Auth stores user ids as BSON UUIDs.
    return user._id instanceof UUID ? user._id.toString() : String(user._id);
  });
}

/**
 * From a page where the signed-in user was just granted the role: `/admin` redirects to
 * `/admin/mfa`, enrollment shows the setup key, and a code computed from it reaches `/admin`.
 */
export async function enrollAdminFactor(page: Page): Promise<void> {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await expect(page.getByRole("heading", { name: "Thiết lập xác thực hai lớp" })).toBeVisible();
  await page.getByRole("button", { name: "Tạo mã thiết lập" }).click();
  const setup = page.getByRole("region", { name: "Thiết lập ứng dụng xác thực" });
  await expect(
    setup.getByText("Lưu các mã dự phòng ở nơi an toàn.", { exact: false }),
  ).toBeVisible();
  const setupKey = (await setup.locator("p.font-mono").first().textContent())?.trim() ?? "";
  expect(setupKey).toMatch(/^[A-Z2-7]+=*$/);
  await page.getByLabel("Mã xác thực").fill(totp(setupKey));
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Signs a new account in, grants it the role and enrolls its factor; returns its user id. */
export async function signInAsSteppedUpAdmin(page: Page, email: string): Promise<string> {
  await page.goto("/auth/sign-in?next=/admin");
  await signInThroughMagicLink(page, email);
  const userId = await setRole(email, "admin");
  await enrollAdminFactor(page);
  return userId;
}

/** Removes what an admin journey adds: factor, step-ups, its audit records and the account. */
export async function cleanupAdminAccount(
  email: string,
  userId: string | undefined,
  targetIds: readonly string[] = [],
): Promise<void> {
  await withE2eDatabase(async (database) => {
    const storedId = userId ? [userId, ...(UUID.isValid(userId) ? [new UUID(userId)] : [])] : [];
    await Promise.all([
      ...(userId
        ? [
            database.collection("twoFactors").deleteMany({ userId: { $in: storedId } }),
            database.collection("adminStepUps").deleteMany({ userId }),
            database.collection("auditLog").deleteMany({ "actor.id": userId }),
            database.collection("accounts").deleteMany({ userId: { $in: storedId } }),
            database.collection("sessions").deleteMany({ userId: { $in: storedId } }),
          ]
        : []),
      ...targetIds.map((id) => database.collection("auditLog").deleteMany({ "target.id": id })),
      database.collection("verifications").deleteMany({ identifier: email }),
    ]);
    await database.collection("users").deleteOne({ email });
  });
}
