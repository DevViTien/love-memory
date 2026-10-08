import { GiftDraftResponseSchema } from "@love-memory/contracts";
import { expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

import { giftRefOf } from "./analytics";
import { signInThroughMagicLink } from "./auth";

/** A cleanup record: the gift and, once the journey signed in, the account it created. */
export type E2eRecord = { email?: string; publicId: string };

export const MEMORY_BOX_CONTENT = {
  caption: "Đà Lạt 2023 🌲",
  letter: "Gửi em lá thư cuối",
  opening: "Mở hộp nhé",
  receiver: "Minh Thư",
} as const;

/** What the Studio journey types into a `memory-box@1.1.0` draft. */
export type MemoryBoxJourneyContent = Readonly<{
  /** `YYYY-MM-DD`, typed into the date input; absent leaves the optional field empty. */
  anniversaryDate?: string;
  /** One entry per photo; `undefined` leaves that caption empty. */
  captions: readonly (string | undefined)[];
  letter: string;
  opening: string;
  /** Fixture file names, uploaded in this order. */
  photos: readonly string[];
  receiver: string;
}>;

/** The typical gift: three photos, two captions. */
export const TYPICAL_MEMORY_BOX: MemoryBoxJourneyContent = {
  captions: [MEMORY_BOX_CONTENT.caption, "Biển mùa hè"],
  letter: MEMORY_BOX_CONTENT.letter,
  opening: MEMORY_BOX_CONTENT.opening,
  photos: ["photo.jpg", "photo-2.jpg", "photo-3.jpg"],
  receiver: MEMORY_BOX_CONTENT.receiver,
};

async function withE2eDatabase<T>(
  operation: (database: ReturnType<MongoClient["db"]>) => Promise<T>,
): Promise<T> {
  const uri = process.env["MONGODB_URI"];
  const databaseName = process.env["MONGODB_DATABASE"];
  if (!uri || !databaseName) {
    throw new Error("E2E database access requires MONGODB_URI and MONGODB_DATABASE.");
  }
  const client = await new MongoClient(uri).connect();
  try {
    return await operation(client.db(databaseName));
  } finally {
    await client.close();
  }
}

/** Removes the gift with everything that references it, and the journey's account. */
export async function cleanupE2eRecord(record: Readonly<E2eRecord>): Promise<void> {
  await withE2eDatabase(async (database) => {
    const gift = await database
      .collection<{ _id: string }>("gifts")
      .findOne({ publicId: record.publicId }, { projection: { _id: 1 } });
    const user = record.email
      ? await database
          .collection<{ _id: string }>("users")
          .findOne({ email: record.email }, { projection: { _id: 1 } })
      : null;
    await Promise.all([
      // Funnel events of the gift (the same HMAC the web server computes with the test secret).
      ...(gift
        ? [database.collection("analyticsEvents").deleteMany({ giftRef: giftRefOf(gift._id) })]
        : []),
      ...(gift
        ? ["assets", "giftPublications", "giftRevisions", "idempotencyKeys", "previewTokens"].map(
            (name) => database.collection(name).deleteMany({ giftId: gift._id }),
          )
        : []),
      ...(user
        ? [
            database.collection("accounts").deleteMany({ userId: user._id }),
            database.collection("sessions").deleteMany({ userId: user._id }),
          ]
        : []),
      ...(record.email
        ? [database.collection("verifications").deleteMany({ identifier: record.email })]
        : []),
    ]);
    await database.collection("gifts").deleteOne({ publicId: record.publicId });
    if (user) await database.collection<{ _id: string }>("users").deleteOne({ _id: user._id });
  });
}

/** Creates an anonymous `memory-box@1.1.0` draft from inside the page (the cookie is `Secure`). */
export async function createMemoryBoxDraft(page: Page): Promise<string> {
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
  return GiftDraftResponseSchema.parse(body.data).gift.publicId;
}

export function saveStatus(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /Đã lưu|Đang lưu|Chưa lưu|Mất kết nối/ });
}

export function studioStep(page: Page, name: RegExp): Locator {
  return page.getByRole("navigation", { name: "Các bước tạo quà" }).getByRole("button", { name });
}

/** Resolves once React has hydrated the element, so a click reaches its handler. */
export async function waitForHydration(element: Locator): Promise<void> {
  await expect(element).toBeVisible();
  await expect
    .poll(() =>
      element.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
}

/** The internal id of a gift, read from the E2E database (never shown by any page). */
export async function findGiftId(publicId: string): Promise<string> {
  const gift = await withE2eDatabase((database) =>
    database.collection<{ _id: string }>("gifts").findOne({ publicId }, { projection: { _id: 1 } }),
  );
  if (!gift) throw new Error("The E2E gift does not exist.");
  return gift._id;
}

/**
 * Fills every required `memory-box@1.1.0` field in the Studio of `publicId` and uploads the
 * content's committed JPEG fixtures with their captions, then waits for `Đã lưu`.
 */
export async function fillCompleteMemoryBox(
  page: Page,
  publicId: string,
  fixturesDirectory: string,
  content: MemoryBoxJourneyContent = TYPICAL_MEMORY_BOX,
): Promise<void> {
  await page.goto(`/studio/${publicId}?field=receiver-name`);
  const receiver = page.getByRole("textbox", { name: "Tên người nhận" });
  // The `?field=` deep link focuses the input from a client effect: the editor has hydrated.
  await expect(receiver).toBeFocused();
  await receiver.fill(content.receiver);
  if (content.anniversaryDate) {
    await page.getByLabel("Ngày kỷ niệm").fill(content.anniversaryDate);
  }

  await studioStep(page, /Lời mở hộp/).click();
  await page.getByRole("textbox", { name: "Lời mở hộp" }).fill(content.opening);

  await studioStep(page, /Kỷ niệm/).click();
  const picker = page.locator('input#studio-field-memories[type="file"]');
  for (const [index, file] of content.photos.entries()) {
    await expect(picker).toBeEnabled();
    await picker.setInputFiles(resolve(fixturesDirectory, file));
    await page
      .getByRole("dialog", { name: "Cắt ảnh theo khung mẫu quà" })
      .getByRole("button", { name: "Dùng vùng ảnh này" })
      .click();
    // A ready item shows its derivative, served by the local object storage route.
    await expect(
      page.locator('img[alt="Ảnh kỷ niệm đã tải"][src*="/api/local-object-storage/"]'),
    ).toHaveCount(index + 1, { timeout: 45_000 });
  }
  for (const [index, caption] of content.captions.entries()) {
    if (caption !== undefined) await page.getByLabel(`Chú thích ảnh ${index + 1}`).fill(caption);
  }

  await studioStep(page, /Lá thư/).click();
  await page.getByRole("textbox", { name: "Lá thư cuối" }).fill(content.letter);
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 15_000 });
}

/** The draft's asset ids, read from inside the page like the Studio's own requests. */
export async function listDraftAssetIds(page: Page, publicId: string): Promise<string[]> {
  const listed = await page.evaluate(async (giftPublicId) => {
    const response = await fetch(
      `/api/media/assets?giftPublicId=${encodeURIComponent(giftPublicId)}`,
    );
    const body = (await response.json()) as { data?: { assets: Array<{ assetId: string }> } };
    return {
      assetIds: body.data?.assets.map((asset) => asset.assetId) ?? [],
      status: response.status,
    };
  }, publicId);
  expect(listed.status).toBe(200);
  return listed.assetIds;
}

/**
 * Publishes a typical gift for specs that need a live share link but not the publish journey
 * itself (`publish.spec.ts` covers that): a visitor's draft and a magic-link sign-in back to the
 * Studio, which claims the draft, then the publish through the same API the Studio calls.
 */
export async function publishTypicalMemoryBox(
  page: Page,
  fixturesDirectory: string,
  email: string,
): Promise<Readonly<{ giftId: string; record: E2eRecord; shareUrl: string }>> {
  const publicId = await createMemoryBoxDraft(page);
  const record: E2eRecord = { email, publicId };
  await fillCompleteMemoryBox(page, publicId, fixturesDirectory);
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(`/studio/${publicId}`)}`);
  await signInThroughMagicLink(page, email);
  await expect(page).toHaveURL(new RegExp(`/studio/${publicId}`));
  const published = await page.evaluate(
    async ({ idempotencyKey, giftPublicId }) => {
      const json = { "Content-Type": "application/json" };
      const draft = (await (await fetch(`/api/gifts/${giftPublicId}`)).json()) as {
        data: { gift: { revision: number } };
      };
      const response = await fetch(`/api/gifts/${giftPublicId}/publish`, {
        // Three photos: the Free plan, which needs no payment.
        body: JSON.stringify({ expectedRevision: draft.data.gift.revision, planId: "free" }),
        headers: { ...json, "Idempotency-Key": idempotencyKey },
        method: "POST",
      });
      const body = (await response.json()) as { data?: { publication: { shareId: string } } };
      return { shareId: body.data?.publication.shareId ?? null, status: response.status };
    },
    { giftPublicId: publicId, idempotencyKey: randomUUID() },
  );
  expect(published.status).toBe(201);
  return {
    giftId: await findGiftId(publicId),
    record,
    shareUrl: new URL(`/g/${published.shareId}`, page.url()).href,
  };
}
