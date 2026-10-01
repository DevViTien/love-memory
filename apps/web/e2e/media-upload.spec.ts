import { GiftDraftResponseSchema } from "@love-memory/contracts";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { type Page } from "@playwright/test";
import { MongoClient } from "mongodb";

import { expect, test } from "./test";

// Requires add-memory-box-template (seeded memory-box@1.1.0 with the `memories` field) and
// add-schema-driven-studio (`?field=` deep link and `studio-field-{fieldId}` ids).
// Playwright's web server runs with STORAGE_DRIVER=local, so no Blob credential is needed.

const createdGifts: string[] = [];

async function cleanupGift(publicId: string): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  const databaseName = process.env["MONGODB_DATABASE"];
  if (!uri || !databaseName) {
    throw new Error("E2E database cleanup requires MONGODB_URI and MONGODB_DATABASE.");
  }
  const client = await new MongoClient(uri).connect();
  try {
    const database = client.db(databaseName);
    const gift = await database
      .collection<{ _id: string }>("gifts")
      .findOne({ publicId }, { projection: { _id: 1 } });
    if (gift) {
      await Promise.all([
        database.collection("assets").deleteMany({ giftId: gift._id }),
        database.collection("giftRevisions").deleteMany({ giftId: gift._id }),
        database.collection("idempotencyKeys").deleteMany({ giftId: gift._id }),
      ]);
    }
    await database.collection("gifts").deleteOne({ publicId });
  } finally {
    await client.close();
  }
}

test.afterEach(async () => {
  await Promise.all(createdGifts.splice(0).map(cleanupGift));
});

function responseData(payload: unknown): unknown {
  return typeof payload === "object" && payload !== null && "data" in payload ? payload.data : null;
}

test("uploads a real image through the Studio field into local object storage", async ({
  baseURL,
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const created = await page.evaluate(async (key) => {
    const response = await fetch("/api/gifts", {
      body: JSON.stringify({ templateId: "memory-box", templateVersion: "1.1.0" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      method: "POST",
    });
    const body: unknown = await response.json();
    return { body, status: response.status };
  }, randomUUID());
  expect(created.status).toBe(201);
  const publicId = GiftDraftResponseSchema.parse(responseData(created.body)).gift.publicId;
  createdGifts.push(publicId);

  const studio = await page.goto(`/studio/${publicId}?field=memories`);
  const policy = studio?.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(new RegExp(`connect-src [^;]*${baseURL!.replaceAll(".", "\\.")}`));

  // Resolved from the spec file, not the working directory. `import.meta.dirname` is unavailable
  // here: `apps/web` is not an ES module package, so Playwright compiles specs to CommonJS.
  const fixturePath = resolve(dirname(test.info().file), "fixtures", "photo.jpg");
  const picker = page.locator('input#studio-field-memories[type="file"]');
  // The `?field=` deep link focuses the picker from a client effect, so focus proves the editor
  // has hydrated and the picker's change handler is attached before a file is chosen.
  await expect(picker).toBeFocused();
  await picker.setInputFiles(fixturePath);
  await page
    .getByRole("dialog", { name: "Cắt ảnh theo khung mẫu quà" })
    .getByRole("button", { name: "Dùng vùng ảnh này" })
    .click();

  const readyImage = page
    .locator('#studio-field-memories img[src*="/api/local-object-storage/"]')
    .or(page.locator('img[alt="Ảnh kỷ niệm đã tải"][src*="/api/local-object-storage/"]'))
    .first();
  await expect(readyImage).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() => readyImage.evaluate((image: HTMLImageElement) => image.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const derivativeUrl = await readyImage.getAttribute("src");
  expect(derivativeUrl).toBeTruthy();
  const derivative = new URL(derivativeUrl!);
  expect(derivative.origin).toBe(new URL(baseURL!).origin);

  const download = await page.request.get(derivative.toString());
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("image/webp");
  expect(download.headers()["cache-control"]).toBe("private, no-store");
  expect(download.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");

  const tampered = new URL(derivative);
  const signature = tampered.searchParams.get("signature")!;
  tampered.searchParams.set(
    "signature",
    `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`,
  );
  expect((await page.request.get(tampered.toString())).status()).toBe(403);

  for (const traversal of [
    "/api/local-object-storage/private/assets/%2E%2E/%2E%2E/.env",
    "/api/local-object-storage/private/..%2F..%2Fsecret?expires=1&signature=x",
  ]) {
    expect((await page.request.get(traversal)).status()).toBe(404);
  }

  expect((await page.request.delete(derivative.toString())).status()).toBe(405);
  expect((await page.request.head(derivative.toString())).status()).toBe(403);
  const options = await page.request.fetch(derivative.toString(), { method: "OPTIONS" });
  expect(options.status()).toBe(204);
  expect(options.headers()["allow"]).toBe("GET, HEAD, OPTIONS, PUT");

  // Deleting the asset removes the stored objects: the still-valid URL now answers 404. The draft
  // cookie is `Secure`, which Chrome sends to http://127.0.0.1 but Playwright's request context does
  // not, so these owner calls run inside the page like the Studio's own requests.
  const deleted = await page.evaluate(async (giftPublicId) => {
    const listed = await fetch(
      `/api/media/assets?giftPublicId=${encodeURIComponent(giftPublicId)}`,
    );
    const body = (await listed.json()) as { data?: { assets: Array<{ assetId: string }> } };
    const assetId = body.data?.assets[0]?.assetId;
    if (!listed.ok || !assetId) return { listStatus: listed.status, status: 0 };
    const response = await fetch(`/api/media/assets/${assetId}`, {
      body: JSON.stringify({ giftPublicId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    return { listStatus: listed.status, status: response.status };
  }, publicId);
  expect(deleted).toEqual({ listStatus: 200, status: 200 });
  expect((await page.request.get(derivative.toString())).status()).toBe(404);
});

/** Creates an anonymous memory-box draft, opens its image field and confirms one crop. */
async function uploadOnePhoto(page: Page): Promise<void> {
  await page.goto("/");
  const created = await page.evaluate(async (key) => {
    const response = await fetch("/api/gifts", {
      body: JSON.stringify({ templateId: "memory-box", templateVersion: "1.1.0" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      method: "POST",
    });
    const body: unknown = await response.json();
    return { body, status: response.status };
  }, randomUUID());
  expect(created.status).toBe(201);
  const publicId = GiftDraftResponseSchema.parse(responseData(created.body)).gift.publicId;
  createdGifts.push(publicId);

  await page.goto(`/studio/${publicId}?field=memories`);
  const picker = page.locator('input#studio-field-memories[type="file"]');
  await expect(picker).toBeFocused();
  await picker.setInputFiles(resolve(dirname(test.info().file), "fixtures", "photo.jpg"));
  await page
    .getByRole("dialog", { name: "Cắt ảnh theo khung mẫu quà" })
    .getByRole("button", { name: "Dùng vùng ảnh này" })
    .click();
}

/** English API text that must never reach the creator. */
const RAW_SERVER_TEXT = /not in a state|Media asset was not found|could not be completed/;

test("shows the cropped photo, upload progress and processing state in Vietnamese", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let releaseUpload: () => void = () => undefined;
  const uploadHeld = new Promise<void>((resolve) => (releaseUpload = resolve));
  await page.route(/\/api\/local-object-storage\//, async (route) => {
    if (route.request().method() === "PUT") await uploadHeld;
    await route.continue();
  });
  // While held, the status polling reports the photo as still processing, as a slow worker would.
  let holdProcessing = true;
  await page.route(/\/api\/media\/assets\?.*includeDownloadUrls=false/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { assets: Array<Record<string, unknown>> } };
    if (holdProcessing) {
      body.data.assets = body.data.assets.map((asset) =>
        asset["status"] === "ready" ? { ...asset, status: "processing" } : asset,
      );
    }
    await route.fulfill({ json: body, response });
  });

  await uploadOnePhoto(page);

  const field = page.locator("fieldset", { has: page.locator("#studio-field-memories") });
  const localPhoto = field.getByRole("img", { name: "Ảnh kỷ niệm vừa chọn" });
  await expect(localPhoto).toBeVisible();
  expect(await localPhoto.getAttribute("src")).toMatch(/^blob:/);
  const progress = field.getByRole("progressbar", { name: /^Tiến độ tải lên / });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuemin", "0");
  await expect(progress).toHaveAttribute("aria-valuemax", "100");
  await expect(field.getByText(/^Đang tải lên \d{1,3}%$/)).toBeVisible();

  releaseUpload();
  await expect(field.getByText("Đang xử lý ảnh…")).toBeVisible({ timeout: 20_000 });
  await expect(field.getByText("Đang xử lý", { exact: true })).toBeVisible();
  await expect(progress).toBeHidden();
  expect(await localPhoto.getAttribute("src")).toMatch(/^blob:/);

  holdProcessing = false;
  const readyPhoto = field.getByRole("img", { name: "Ảnh kỷ niệm đã tải" });
  await expect(readyPhoto).toHaveAttribute("src", /\/api\/local-object-storage\//, {
    timeout: 20_000,
  });
  await expect(field.getByText("Đang xử lý ảnh…")).toBeHidden();
  await expect(localPhoto).toBeHidden();
  // Scoped to the field: the Next.js route announcer is an (empty) `alert` region too.
  await expect(field.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(RAW_SERVER_TEXT);
});

test("treats a late duplicate completion (409) as success instead of an error", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The server accepts the completion, but the browser receives the 409 that a second, late
  // completion request of the same asset would get.
  await page.route("**/api/media/uploads/complete", async (route) => {
    const accepted = await route.fetch();
    expect(accepted.status()).toBe(202);
    await route.fulfill({
      json: {
        error: {
          code: "CONFLICT",
          message: "The asset is not in a state that allows this operation.",
          requestId: "e2e-late-completion",
        },
      },
      status: 409,
    });
  });

  await uploadOnePhoto(page);

  const field = page.locator("fieldset", { has: page.locator("#studio-field-memories") });
  await expect(field.getByRole("img", { name: "Ảnh kỷ niệm đã tải" })).toHaveAttribute(
    "src",
    /\/api\/local-object-storage\//,
    { timeout: 45_000 },
  );
  await expect(field.getByRole("button", { name: "Hoàn tất tải lên" })).toHaveCount(0);
  // Scoped to the field: the Next.js route announcer is an (empty) `alert` region too.
  await expect(field.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(RAW_SERVER_TEXT);
});
