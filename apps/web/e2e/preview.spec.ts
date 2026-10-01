import { GiftDraftResponseSchema } from "@love-memory/contracts";
import { type FrameLocator, type Locator, type Page, type Request } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { MongoClient } from "mongodb";

import { assignOwnAuthClientAddress, expect, test } from "./test";
import { captureViewerScreenshot } from "./viewer-harness";

// Requires add-memory-box-template (memory-box@1.1.0), add-schema-driven-studio (`?field=` deep
// links, `flush()`) and add-local-object-storage: the Playwright web server runs with
// STORAGE_DRIVER=local, so uploads and signed image URLs stay on the app origin.

const VIEWER_TITLE = "LoveMemory template viewer";
const CAPTION = "Đà Lạt 2023 🌲";
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
        database.collection("previewTokens").deleteMany({ giftId: gift._id }),
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
  createdGifts.push(publicId);
  return publicId;
}

function saveStatus(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /Đã lưu|Đang lưu|Chưa lưu|Mất kết nối/ });
}

function viewerFrame(page: Page): FrameLocator {
  return page.frameLocator(`iframe[title="${VIEWER_TITLE}"]`);
}

function scene(frame: FrameLocator, sceneId: string): Locator {
  return frame.locator(`section[data-scene="${sceneId}"]`);
}

/** The iframe gets its artifact URL only from a client effect: proof the gift viewer hydrated. */
async function waitForGiftViewer(page: Page): Promise<void> {
  await expect(page.locator(`iframe[title="${VIEWER_TITLE}"]`)).toHaveAttribute(
    "src",
    /\/template-artifacts\/memory-box\/1\.1\.0\//,
  );
}

async function naturalWidth(image: Locator): Promise<number> {
  return image.evaluate((element: HTMLImageElement) => element.naturalWidth);
}

/** Holds the template artifact request until `release`, so a restart's pending state is seen. */
async function holdArtifact(page: Page): Promise<Readonly<{ release: () => Promise<void> }>> {
  let open: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  const pattern = "**/template-artifacts/**";
  await page.route(pattern, async (route) => {
    await held;
    await route.continue();
  });
  return {
    release: async () => {
      open();
      await page.unrouteAll({ behavior: "wait" });
    },
  };
}

/** The frame overlay; the polite status announces the same text while it shows. */
function loadingOverlay(page: Page): Locator {
  return page.locator("[data-preview-loading]").filter({ hasText: "Đang tải lại bản xem trước…" });
}

/** The restart ended: both controls are idle again and the frame overlay is gone. */
async function expectControlsIdle(page: Page): Promise<void> {
  const restart = page.getByRole("button", { exact: true, name: "Phát lại" });
  await expect(restart).toBeVisible({ timeout: 20_000 });
  await expect(restart).not.toHaveAttribute("aria-busy", "true");
  await expect(restart).toBeEnabled();
  await expect(page.getByRole("button", { name: "Giảm chuyển động" })).toBeEnabled();
  await expect(loadingOverlay(page)).toHaveCount(0);
}

/** Opens the gift and presses the in-frame `Tiếp` until the first memory card shows. */
async function openToFirstMemory(page: Page): Promise<FrameLocator> {
  await page.getByRole("button", { name: "Mở quà" }).click();
  const frame = viewerFrame(page);
  const memory = scene(frame, "memory-1");
  for (let attempt = 0; attempt < 4 && !(await memory.isVisible()); attempt += 1) {
    const next = frame.getByRole("button", { name: "Tiếp" });
    if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(500);
  }
  await expect(memory).toBeVisible();
  return frame;
}

test("previews a Memory Box draft with a photo, issues, fallback and Sửa links", async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.setTimeout(150_000);

  // 1–2. A draft with one uploaded, captioned photo.
  const publicId = await createMemoryBoxDraft(page);
  await page.goto(`/studio/${publicId}?field=memories`);
  const picker = page.locator('input#studio-field-memories[type="file"]');
  await expect(picker).toBeFocused();
  await picker.setInputFiles(resolve(dirname(test.info().file), "fixtures", "photo.jpg"));
  await page
    .getByRole("dialog", { name: "Cắt ảnh theo khung mẫu quà" })
    .getByRole("button", { name: "Dùng vùng ảnh này" })
    .click();
  const readyImage = page
    .locator('#studio-field-memories img[src*="/api/local-object-storage/"]')
    .or(page.locator('img[alt="Ảnh kỷ niệm đã tải"][src*="/api/local-object-storage/"]'))
    .first();
  await expect(readyImage).toBeVisible({ timeout: 45_000 });
  await page.getByLabel("Chú thích ảnh 1").fill(CAPTION);

  // 3. Saved, then `Xem trước` from its step.
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 15_000 });
  await page
    .getByRole("navigation", { name: "Các bước tạo quà" })
    .getByRole("button", { name: /Xem trước/ })
    .click();
  const previewDocument = page.waitForResponse(
    (response) =>
      response.url().includes("/preview/") && response.request().resourceType() === "document",
  );
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();

  // 4. A private, uncached, unindexed page with the nonce policy.
  const response = await previewDocument;
  await expect(page).toHaveURL(/\/preview\/[A-Za-z0-9_-]{43}$/);
  const previewUrl = page.url();
  const headers = response.headers();
  expect(headers["cache-control"]).toContain("private");
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["x-robots-tag"]).toBe("noindex");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["content-security-policy"]).toContain("'strict-dynamic'");
  await expect(page).toHaveTitle("Xem trước quà · LoveMemory");

  // 5. Server issues with `Sửa` links.
  const panel = page.getByRole("region", { name: "Cần hoàn thiện" });
  const receiverIssue = panel
    .getByRole("listitem")
    .filter({ hasText: "Tên người nhận: chưa có nội dung." });
  await expect(receiverIssue.getByRole("link", { name: "Sửa" })).toHaveAttribute(
    "href",
    `/studio/${publicId}?field=receiver-name`,
  );
  await expect(
    panel
      .getByRole("listitem")
      .filter({ hasText: "Ảnh kỷ niệm: cần ít nhất 3 ảnh." })
      .getByRole("link", { name: "Sửa" }),
  ).toBeVisible();

  // 6. The photo and its caption inside the template.
  await waitForGiftViewer(page);
  let frame = await openToFirstMemory(page);
  const photo = scene(frame, "memory-1").locator("img");
  await expect.poll(() => naturalWidth(photo), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(scene(frame, "memory-1").getByText(CAPTION)).toBeVisible();
  const viewerBox = page.locator("[data-viewport]");
  await captureViewerScreenshot(viewerBox, testInfo, "preview-memory-1-phone");

  // 7. Desktop viewport, then restarts back to the envelope.
  await page.getByRole("button", { name: "Máy tính" }).click();
  await expect(viewerBox).toHaveAttribute("data-viewport", "desktop");
  await expect(scene(frame, "memory-1")).toBeVisible();
  await captureViewerScreenshot(viewerBox, testInfo, "preview-memory-1-desktop");

  // 7a. A fast restart (the held URLs stay valid): no server round trip, busy feedback until the
  //     new template is ready, then the animated runtime, never the static rendering.
  const previewRequests: string[] = [];
  const onPreviewRequest = (sent: Request) => {
    if (new URL(sent.url()).pathname.startsWith("/preview/")) previewRequests.push(sent.method());
  };
  page.on("request", onPreviewRequest);
  let artifact = await holdArtifact(page);
  await page.getByRole("button", { exact: true, name: "Phát lại" }).click();
  const busyRestart = page.getByRole("button", { name: "Đang phát lại…" });
  await expect(busyRestart).toHaveAttribute("aria-busy", "true");
  await expect(busyRestart).toHaveAttribute("aria-disabled", "true");
  await expect(busyRestart).toBeFocused();
  await expect(page.getByRole("button", { name: "Giảm chuyển động" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Điện thoại" })).toBeEnabled();
  await expect(loadingOverlay(page)).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Đang tải lại bản xem trước…" }),
  ).toHaveAttribute("aria-live", "polite");
  await artifact.release();
  await expectControlsIdle(page);
  await expect(page.getByRole("heading", { name: "Bạn có một món quà" })).toBeVisible();
  page.off("request", onPreviewRequest);
  expect(previewRequests).toEqual([]);
  frame = await openToFirstMemory(page);
  await expect
    .poll(() => naturalWidth(scene(frame, "memory-1").locator("img")), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Nội dung món quà" })).toHaveCount(0);

  // 7b. The reduced-motion toggle restarts the same way, with `prefersReducedMotion`.
  artifact = await holdArtifact(page);
  await page.getByRole("button", { name: "Giảm chuyển động" }).click();
  const busyMotion = page.getByRole("button", { name: "Đang áp dụng…" });
  await expect(busyMotion).toHaveAttribute("aria-busy", "true");
  await expect(busyMotion).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { exact: true, name: "Phát lại" })).toBeDisabled();
  await artifact.release();
  await expectControlsIdle(page);
  await expect(viewerFrame(page).locator("body")).toHaveAttribute("data-motion", "reduced");
  frame = await openToFirstMemory(page);
  await expect(page.getByRole("region", { name: "Nội dung món quà" })).toHaveCount(0);

  // 7c. Close to the URLs' expiry, a restart re-reads the draft first; the busy state holds while
  //     the server answers.
  //     Only this document's clock moves; the reload in step 8 restores it.
  await page.evaluate(() => {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + 250_000;
  });
  let releaseRefresh: () => void = () => {};
  const refreshHeld = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let refreshes = 0;
  await page.route(
    (url) => url.pathname.startsWith("/preview/"),
    async (route) => {
      if (route.request().headers()["rsc"] === "1") {
        refreshes += 1;
        await refreshHeld;
      }
      await route.continue();
    },
  );
  await page.getByRole("button", { exact: true, name: "Phát lại" }).click();
  await expect(page.getByRole("button", { name: "Đang phát lại…" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(loadingOverlay(page)).toBeVisible();
  await expect.poll(() => refreshes).toBe(1);
  releaseRefresh();
  await expectControlsIdle(page);
  await expect(page.getByRole("heading", { name: "Bạn có một món quà" })).toBeVisible();
  expect(refreshes).toBe(1);
  await page.unrouteAll({ behavior: "wait" });

  // 8. Reload: the artifact comes from the browser cache and still plays.
  await page.reload();
  await waitForGiftViewer(page);
  frame = await openToFirstMemory(page);
  await expect
    .poll(() => naturalWidth(scene(frame, "memory-1").locator("img")), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Nội dung món quà" })).toHaveCount(0);

  // 9. Another device: the link alone renders the preview, without edit links or draft access.
  const guestContext = await browser.newContext();
  await assignOwnAuthClientAddress(guestContext);
  try {
    const guest = await guestContext.newPage();
    await guest.goto(previewUrl);
    const guestPanel = guest.getByRole("region", { name: "Cần hoàn thiện" });
    await expect(guestPanel.getByText("Tên người nhận: chưa có nội dung.")).toBeVisible();
    await expect(guestPanel.getByRole("link", { name: "Sửa" })).toHaveCount(0);
    await expect(guestPanel.getByText("Mở Studio trên thiết bị đã tạo quà để sửa.")).toBeVisible();
    await expect(guest.getByRole("link", { name: "Quay lại chỉnh sửa" })).toHaveCount(0);
    expect((await guest.request.get(`/api/gifts/${publicId}`)).status()).toBe(404);
  } finally {
    await guestContext.close();
  }

  // 10. A broken template: the static rendering keeps the caption and the photo.
  const brokenContext = await browser.newContext();
  await assignOwnAuthClientAddress(brokenContext);
  try {
    const broken = await brokenContext.newPage();
    await broken.route("**/template-artifacts/**", (route) =>
      route.fulfill({ body: "<html></html>", contentType: "text/html" }),
    );
    await broken.goto(previewUrl);
    await waitForGiftViewer(broken);
    await broken.getByRole("button", { name: "Mở quà" }).click();
    const staticRegion = broken.getByRole("region", { name: "Nội dung món quà" });
    await expect(staticRegion).toBeVisible({ timeout: 20_000 });
    await expect(staticRegion.getByText(CAPTION)).toBeVisible();
    const staticPhoto = staticRegion.locator("img").first();
    await expect.poll(() => naturalWidth(staticPhoto), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(
      broken.getByText(
        "Mẫu quà gặp lỗi khi hiển thị. Người nhận sẽ thấy bản tĩnh với đầy đủ nội dung.",
      ),
    ).toBeVisible();
    await captureViewerScreenshot(broken.locator("[data-viewport]"), testInfo, "preview-fallback");
  } finally {
    await brokenContext.close();
  }

  // 11. `Sửa` leads back to the focused Studio field.
  await receiverIssue.getByRole("link", { name: "Sửa" }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/${publicId}\\?step=recipient$`));
  await expect(page.locator("#studio-field-receiver-name")).toBeFocused();

  // 12. An unknown token renders the opaque not-found page with a real 404.
  const unknown = await page.goto(`/preview/${randomBytes(32).toString("base64url")}`);
  await expect(page.getByText("Kỷ niệm này chưa tồn tại.")).toBeVisible();
  expect(unknown?.status()).toBe(404);
  expect(unknown?.headers()["x-robots-tag"]).toBe("noindex");
  const malformed = await page.goto("/preview/abc");
  expect(malformed?.status()).toBe(404);

  // 13. The issue route refuses requests without credentials or with the wrong media type.
  const anonymous = await request.post(`/api/gifts/${publicId}/preview`, {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  expect(anonymous.status()).toBe(404);
  const plain = await request.post(`/api/gifts/${publicId}/preview`, {
    data: "{}",
    headers: { "Content-Type": "text/plain" },
  });
  expect(plain.status()).toBe(415);
});
