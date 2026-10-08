import { type FrameLocator, type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./test";
import { captureViewerScreenshot, pressTemplateNext } from "./viewer-harness";

const HARNESS = "/viewer/memory-box/1.1.0";
const VIEWER_TITLE = "LoveMemory template viewer";

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** Network (http/https) subresources requested by the artifact frame; `data:` images are not. */
function captureArtifactRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      request.frame().url().includes("/template-artifacts/") &&
      request.resourceType() !== "document" &&
      /^https?:/.test(url)
    ) {
      requests.push(url);
    }
  });
  return requests;
}

async function openHarness(page: Page, fixture = "default") {
  await page.goto(fixture === "default" ? HARNESS : `${HARNESS}?fixture=${fixture}`);
  const viewer = page.getByTitle(VIEWER_TITLE);
  const frame = page.frameLocator(`iframe[title="${VIEWER_TITLE}"]`);
  await expect(page.getByText(/Trạng thái: READY/)).toBeVisible();
  return { frame, viewer };
}

async function loggedEvents(page: Page): Promise<Array<{ sceneId?: string; type: string }>> {
  const entries = await page.locator("ol > li").allTextContents();
  return entries.map((entry) => JSON.parse(entry) as { sceneId?: string; type: string });
}

async function loggedSceneIds(page: Page): Promise<string[]> {
  return (await loggedEvents(page)).flatMap((event) =>
    event.type === "SCENE" && event.sceneId ? [event.sceneId] : [],
  );
}

async function loggedReadyCount(page: Page): Promise<number> {
  return (await loggedEvents(page)).filter((event) => event.type === "READY").length;
}

function scene(frame: FrameLocator, sceneId: string): Locator {
  return frame.locator(`section[data-scene="${sceneId}"]`);
}

/**
 * Pauses playback before a capture, so no automatic advance can change the scene while the
 * screenshot is taken, then resumes. Asserts the scene is still the expected one while paused.
 */
async function captureWhilePaused(
  page: Page,
  frame: FrameLocator,
  viewer: Locator,
  testInfo: TestInfo,
  sceneId: string,
  name: string,
) {
  await page.getByRole("button", { name: "Tạm dừng" }).click();
  await expect(frame.locator("body")).toHaveAttribute("data-paused", "true");
  await expect(scene(frame, sceneId)).toBeVisible();
  await captureViewerScreenshot(viewer, testInfo, name);
  await page.getByRole("button", { name: "Phát" }).click();
  await expect(frame.locator("body")).not.toHaveAttribute("data-paused");
}

/** Asserts that `Tiếp` lies entirely inside the artifact frame's own viewport. */
async function expectNextInsideFrame(frame: FrameLocator, label: string) {
  const inside = await frame.getByRole("button", { name: "Tiếp" }).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
  });
  expect(inside, `Tiếp outside the frame viewport in ${label}`).toBe(true);
}

/** Presses the in-frame `Tiếp` button once the scene settled, and waits for the next scene. */
async function advance(frame: FrameLocator, nextSceneId: string) {
  await pressTemplateNext(frame);
  await expect(scene(frame, nextSceneId)).toBeVisible();
}

async function expectNoHorizontalOverflow(frame: FrameLocator, label: string) {
  const overflow = await frame.locator("html").evaluate((root) => {
    const offenders = [root, ...root.querySelectorAll<HTMLElement>(".letter, .stage, #app")];
    return offenders
      .filter((element) => element.scrollWidth > element.clientWidth)
      .map((element) => `${element.tagName}.${element.className}`);
  });
  expect(overflow, `horizontal overflow in ${label}`).toEqual([]);
}

test("lists the Memory Box fixtures and initializes with data: images", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  const artifactRequests = captureArtifactRequests(page);
  const { frame, viewer } = await openHarness(page);

  await expect(viewer).toHaveAttribute("sandbox", "allow-scripts");
  await expect(
    page.getByRole("navigation", { name: "Fixture Viewer" }).getByRole("link"),
  ).toHaveText(["default", "max-length", "missing-fields", "broken-image"]);
  await expect(page.getByText("Vấn đề nội dung: 0")).toBeVisible();
  await expect(frame.getByRole("heading", { level: 1 })).toHaveText("Gửi An");
  await expect(frame.getByRole("button")).toHaveCount(0);
  await expect
    .poll(() => artifactRequests.filter((url) => url.endsWith("/runtime.mjs")))
    .toHaveLength(1);
  expect(artifactRequests.filter((url) => !url.endsWith("/runtime.mjs"))).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("plays every Memory Box scene in order to COMPLETE", async ({ page }, testInfo) => {
  const browserErrors = captureBrowserErrors(page);
  const artifactRequests = captureArtifactRequests(page);
  const { frame, viewer } = await openHarness(page);
  await captureViewerScreenshot(viewer, testInfo, "memory-box-cover-rose-night");

  await page.getByRole("button", { name: "Phát" }).click();
  await expect(scene(frame, "opening")).toBeVisible();
  await captureWhilePaused(page, frame, viewer, testInfo, "opening", "memory-box-opening");
  await advance(frame, "memory-1");
  await expect(frame.locator(".frame img")).toHaveAttribute("alt", "Đà Lạt 2023 🌲");
  await captureWhilePaused(page, frame, viewer, testInfo, "memory-1", "memory-box-memory-card");
  for (const next of ["memory-2", "memory-3", "memory-4", "memory-5", "letter"]) {
    await advance(frame, next);
  }
  await captureWhilePaused(page, frame, viewer, testInfo, "letter", "memory-box-letter");
  await advance(frame, "finale");
  await expect(frame.locator(".particle")).not.toHaveCount(0);
  expect(await frame.locator(".particle").count()).toBeLessThanOrEqual(24);
  await expect(page.getByText(/Trạng thái: COMPLETE/)).toBeVisible();
  await captureViewerScreenshot(viewer, testInfo, "memory-box-finale");

  expect(await loggedSceneIds(page)).toEqual([
    "opening",
    "memory-1",
    "memory-2",
    "memory-3",
    "memory-4",
    "memory-5",
    "letter",
    "finale",
  ]);
  expect(artifactRequests.filter((url) => !url.endsWith("/runtime.mjs"))).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("counts distinct broken images once and shows text cards", async ({ page }, testInfo) => {
  const { frame, viewer } = await openHarness(page, "broken-image");

  await expect
    .poll(() => page.getByText(/Vấn đề nội dung: \d+/).textContent())
    .toContain("Vấn đề nội dung: 2");
  // Handshake retries and iframe `load` resend INIT; the distinct count must not grow. Replay the
  // iframe `load` so at least one identical INIT is resent even if the handshake needed only one.
  await viewer.evaluate((element) => element.dispatchEvent(new Event("load")));
  await expect.poll(() => loggedReadyCount(page)).toBeGreaterThan(1);
  await expect(page.getByText("Vấn đề nội dung: 2")).toBeVisible();
  await expect(page.getByText(/Trạng thái: READY/)).toBeVisible();

  await page.getByRole("button", { name: "Phát" }).click();
  await expect(scene(frame, "opening")).toBeVisible();
  await advance(frame, "memory-1");
  await advance(frame, "memory-2");
  await expect(frame.locator(".text-card")).toHaveText("Ảnh không có đường dẫn");
  await captureWhilePaused(page, frame, viewer, testInfo, "memory-2", "memory-box-text-card");
  await advance(frame, "memory-3");
  await expect(frame.locator(".text-card")).toHaveText("Ảnh không giải mã được");
  await expect(frame.locator("img")).toHaveCount(0);
});

test("renders the missing-fields fixture with a neutral cover and completes", async ({
  page,
}, testInfo) => {
  const browserErrors = captureBrowserErrors(page);
  const { frame, viewer } = await openHarness(page, "missing-fields");

  await expect(frame.getByRole("heading", { level: 1 })).toHaveText("Gửi bạn");
  await expect(page.getByText("Vấn đề nội dung: 4")).toBeVisible();
  await captureViewerScreenshot(viewer, testInfo, "memory-box-missing-fields-cover");
  await page.getByRole("button", { name: "Phát" }).click();
  await expect(page.getByText(/Trạng thái: COMPLETE/)).toBeVisible({ timeout: 15_000 });

  expect(await loggedSceneIds(page)).toEqual(["opening", "finale"]);
  expect(browserErrors).toEqual([]);
});

test("removes particles under reduced motion", async ({ page }, testInfo) => {
  const { frame, viewer } = await openHarness(page);

  await page.getByRole("button", { name: /Reduced motion: tắt/ }).click();
  await expect(page.getByRole("button", { name: /Reduced motion: bật/ })).toBeVisible();
  await expect(frame.locator("body")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("button", { name: "Phát" }).click();
  await expect(scene(frame, "opening")).toBeVisible();
  for (const next of [
    "memory-1",
    "memory-2",
    "memory-3",
    "memory-4",
    "memory-5",
    "letter",
    "finale",
  ]) {
    await advance(frame, next);
  }

  await expect(page.getByText(/Trạng thái: COMPLETE/)).toBeVisible();
  await expect(frame.locator(".particle")).toHaveCount(0);
  await captureViewerScreenshot(viewer, testInfo, "memory-box-finale-reduced-motion");
});

test("wraps maximum-length content inside a 320 px mobile frame", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 690, width: 320 });
  const { frame, viewer } = await openHarness(page, "max-length");
  await page.getByRole("button", { name: /Viewport: desktop/ }).click();
  await expect(page.getByRole("button", { name: /Viewport: mobile/ })).toBeVisible();

  const box = await viewer.boundingBox();
  expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(320);
  expect(box && box.height > box.width).toBe(true);
  await expect(scene(frame, "cover")).toBeVisible();
  await captureViewerScreenshot(viewer, testInfo, "memory-box-cover-warm-paper");
  await expectNoHorizontalOverflow(frame, "cover");

  await page.getByRole("button", { name: "Phát" }).click();
  await expect(scene(frame, "opening")).toBeVisible();
  await expectNoHorizontalOverflow(frame, "opening");
  await expectNextInsideFrame(frame, "opening");
  const sequence = [...Array.from({ length: 8 }, (_, index) => `memory-${index + 1}`), "letter"];
  for (const next of sequence) {
    await advance(frame, next);
    await expectNoHorizontalOverflow(frame, next);
    // A 140-character caption must not push `Tiếp` below the 9:16 frame.
    await expectNextInsideFrame(frame, next);
  }

  const letter = frame.locator("div.letter");
  const scrollable = await letter.evaluate(
    (element) => element.scrollHeight > element.clientHeight,
  );
  expect(scrollable).toBe(true);
  await letter.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await advance(frame, "finale");
  await expectNoHorizontalOverflow(frame, "finale");
});
