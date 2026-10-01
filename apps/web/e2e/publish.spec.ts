import {
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

import {
  countByName,
  deleteAnalyticsEvents,
  giftRefOf,
  readAnalyticsEvents,
  recordAnalyticsEvents,
} from "./support/analytics";
import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  createMemoryBoxDraft,
  type E2eRecord,
  fillCompleteMemoryBox,
  findGiftId,
  listDraftAssetIds,
  type MemoryBoxJourneyContent,
  studioStep,
  TYPICAL_MEMORY_BOX,
  waitForHydration,
} from "./support/gift-journey";
import { assignOwnAuthClientAddress, expect, test } from "./test";
import { captureViewerScreenshot } from "./viewer-harness";

// Requires the earlier Sprint 3 changes: memory-box@1.1.0, the step-based Studio, local object
// storage (STORAGE_DRIVER=local on the Playwright web server) and the preview. The web server also
// sets INTERNAL_PUBLISH_ENABLED=true and ANALYTICS_ENABLED=true (`add-funnel-analytics`), so this
// journey is also the Gate M2 funnel, snapshot and edge-case evidence.

const VIEWER_TITLE = "LoveMemory template viewer";
const CREATOR_EVENTS = [
  "customization_started",
  "required_content_completed",
  "preview_started",
  "publish_clicked",
];
const RECIPIENT_EVENTS = ["gift_open_interaction", "scene_completed", "gift_completed"];
const RETENTION_MILLISECONDS = 180 * 24 * 60 * 60 * 1000;
const STORED_EVENT_KEYS = [
  "_id",
  "expiresAt",
  "giftRef",
  "name",
  "occurredAt",
  "sceneId",
  "sessionId",
  "templateId",
  "templateVersion",
];

// A stuck action fails at its own line instead of consuming the whole test timeout.
test.use({ actionTimeout: 20_000 });

const records: E2eRecord[] = [];
const giftRefs: string[] = [];

test.afterEach(async () => {
  await Promise.all(records.splice(0).map(cleanupE2eRecord));
  await deleteAnalyticsEvents(giftRefs.splice(0));
});

/** Text of exactly `length` UTF-16 units (the Studio counter's unit) that never ends in a space. */
function textOfLength(start: string, filler: string, length: number, end = ""): string {
  let middle = "";
  while (start.length + middle.length + end.length < length) middle += filler;
  middle = middle.slice(0, length - start.length - end.length);
  const text = `${start}${middle}${end}`;
  return text.endsWith(" ") ? `${text.slice(0, -1)}.` : text;
}

const EDGE_LETTER = (() => {
  const paragraphs = [
    "Gửi em, người thương của anh.",
    `${"Tiếng Việt".normalize("NFD")} có dấu tổ hợp, và cả những dòng rất dài.`,
    // One unbroken 90-character token: it must wrap instead of overflowing.
    "LoveMemory".repeat(9),
  ];
  const used = paragraphs.join("\n\n").length + 2;
  paragraphs.push(textOfLength("Cảm ơn em ", "vì đã ở bên anh mỗi ngày. ", 1200 - used));
  return paragraphs.join("\n\n");
})();

type JourneyCase = Readonly<{
  content: MemoryBoxJourneyContent;
  /** Values the static fallback must show, beyond the content's own text values. */
  fallbackExtras: readonly string[];
  /** Counters that must read `n/n` after the fill (input id → counter text). */
  maxedCounters: readonly (readonly [string, string])[];
  name: "edge-cases" | "typical";
}>;

const JOURNEYS: readonly JourneyCase[] = [
  { content: TYPICAL_MEMORY_BOX, fallbackExtras: [], maxedCounters: [], name: "typical" },
  {
    content: {
      anniversaryDate: "2024-02-29",
      captions: [
        textOfLength("Đà Lạt mùa hoa dã quỳ 🌼 ", "và những chiều sương ", 140),
        undefined,
        "🌲🇻🇳👍🏽",
        "<b>đậm</b> & <img src=x onerror=alert(1)>",
        "Biển Nha Trang",
        "Hà Nội mùa thu",
        "Sài Gòn mưa",
        "Huế",
      ],
      letter: EDGE_LETTER,
      opening: textOfLength('Mở hộp nhé: <b>không đậm</b> & "trích dẫn" ', "thương ", 120),
      // The committed fixtures reused; `photo.jpg` is the 320×240 landscape photo.
      photos: [
        "photo.jpg",
        "photo-2.jpg",
        "photo-3.jpg",
        "photo.jpg",
        "photo-2.jpg",
        "photo-3.jpg",
        "photo.jpg",
        "photo-2.jpg",
      ],
      receiver: textOfLength("Nguyễn Thị Minh Thư ", "ơ", 40, " 👩‍❤️‍👨"),
    },
    fallbackExtras: ["29/02/2024"],
    maxedCounters: [
      ["studio-field-receiver-name", "40/40"],
      ["studio-field-opening-message", "120/120"],
      ["studio-field-final-letter", "1200/1200"],
    ],
    name: "edge-cases",
  },
];

function viewerFrame(page: Page): FrameLocator {
  return page.frameLocator(`iframe[title="${VIEWER_TITLE}"]`);
}

function scene(frame: FrameLocator, sceneId: string): Locator {
  return frame.locator(`section[data-scene="${sceneId}"]`);
}

async function naturalWidth(image: Locator): Promise<number> {
  return image.evaluate((element: HTMLImageElement) => element.naturalWidth);
}

function expectedSceneIds(content: MemoryBoxJourneyContent): string[] {
  return [
    "opening",
    ...content.photos.map((_photo, index) => `memory-${index + 1}`),
    "letter",
    "finale",
  ];
}

/** Every text value the gift holds, as the static fallback must show it. */
function textValues(journey: JourneyCase): string[] {
  const { content } = journey;
  return [
    content.receiver,
    content.opening,
    ...content.captions.filter((caption): caption is string => caption !== undefined),
    ...content.letter.split("\n\n"),
    ...journey.fallbackExtras,
  ];
}

async function recipientContext(page: Page): Promise<BrowserContext> {
  const browser = page.context().browser();
  if (!browser) throw new Error("A browser is required for a recipient context.");
  // The project's device (Pixel 7 on mobile-chromium), without the creator's cookies.
  const { deviceScaleFactor, hasTouch, isMobile, userAgent, viewport } = test.info().project.use;
  const context = await browser.newContext({
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
    ...(hasTouch === undefined ? {} : { hasTouch }),
    ...(isMobile === undefined ? {} : { isMobile }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(viewport === undefined ? {} : { viewport }),
  });
  await assignOwnAuthClientAddress(context);
  return context;
}

/** Runs an owner API call inside the page: the draft cookie is `Secure`, as in the Studio. */
async function ownerFetch(
  page: Page,
  input: Readonly<{
    body?: string;
    headers?: Record<string, string>;
    method: string;
    path: string;
  }>,
): Promise<Readonly<{ body: unknown; status: number }>> {
  const request = { body: input.body ?? null, headers: input.headers ?? {}, ...input };
  return page.evaluate(async ({ body, headers, method, path }) => {
    const response = await fetch(path, { body, headers, method });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
    return { body: parsed, status: response.status };
  }, request);
}

/** The id of the scene the template shows now (the cover once it is replaced). */
async function currentSceneId(frame: FrameLocator): Promise<string> {
  const section = frame.locator("section[data-scene]:not([data-scene='cover'])");
  await expect(section).toHaveCount(1, { timeout: 20_000 });
  return (await section.getAttribute("data-scene")) ?? "";
}

type SceneText = Readonly<{ sceneId: string; text: string }>;

/**
 * Plays the opened gift to its end with `Tiếp`, collecting the masthead and the text of every
 * scene as it starts. `onScene` runs after the text is read (checks, captures).
 */
async function playScenes(
  page: Page,
  onScene: (sceneId: string) => Promise<void> = () => Promise.resolve(),
): Promise<Readonly<{ masthead: string; scenes: SceneText[] }>> {
  const frame = viewerFrame(page);
  const scenes: SceneText[] = [];
  let current = await currentSceneId(frame);
  const masthead = await frame.locator("header.masthead").innerText();
  for (let guard = 0; guard < 20; guard += 1) {
    scenes.push({ sceneId: current, text: await scene(frame, current).innerText() });
    await onScene(current);
    if (current === "finale") break;
    const previous = current;
    await frame.getByRole("button", { name: "Tiếp" }).click();
    await expect.poll(() => currentSceneId(frame)).not.toBe(previous);
    current = await currentSceneId(frame);
  }
  return { masthead, scenes };
}

/** The `visibilitychange` the host listens to, with `document.hidden` forced to `hidden`. */
async function setPageHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (value ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function expectMinimumTarget(target: Locator, label: string): Promise<void> {
  const box = await target.boundingBox();
  expect(box, `${label} has no box`).not.toBeNull();
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
}

function hostOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  expect(await hostOverflow(page), `host horizontal overflow in ${label}`).toBeLessThanOrEqual(0);
  const offenders = await viewerFrame(page)
    .locator("html")
    .evaluate((root) =>
      [root, ...root.querySelectorAll<HTMLElement>(".letter, .stage, #app")]
        .filter((element) => element.scrollWidth > element.clientWidth)
        .map((element) => `${element.tagName}.${element.className}`),
    );
  expect(offenders, `frame horizontal overflow in ${label}`).toEqual([]);
}

async function expectNextInsideFrame(frame: FrameLocator, label: string): Promise<void> {
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

/**
 * Freezes the scene through the host's own pause path (the page reports hidden, the host sends
 * `PAUSE`, the template marks `data-paused`), captures it, then resumes with `Tiếp tục`. The pause
 * overlay is hidden for the screenshot only, so the capture shows the scene undimmed.
 */
async function captureFrozenScene(
  page: Page,
  testInfo: TestInfo,
  sceneId: string,
  name: string,
): Promise<void> {
  const frame = viewerFrame(page);
  await expect(scene(frame, sceneId)).toBeVisible();
  await setPageHidden(page, true);
  await expect(frame.locator("body")).toHaveAttribute("data-paused", "true");
  const resume = page.getByRole("button", { name: "Tiếp tục" });
  await expect(resume).toBeVisible();
  await expectMinimumTarget(resume, "Tiếp tục");
  await expect(scene(frame, sceneId)).toBeVisible();
  // A handle, not a role locator: a hidden overlay is no longer found by its role.
  const overlay = await resume.evaluateHandle((button) => button.parentElement as HTMLElement);
  await overlay.evaluate((element) => (element.style.visibility = "hidden"));
  await captureViewerScreenshot(page.locator("[data-public-gift]"), testInfo, name);
  await overlay.evaluate((element) => (element.style.visibility = ""));
  await overlay.dispose();
  await expect(scene(frame, sceneId)).toBeVisible();
  await setPageHidden(page, false);
  await resume.click();
  await expect(frame.locator("body")).not.toHaveAttribute("data-paused");
}

async function runPublishJourney(page: Page, testInfo: TestInfo, journey: JourneyCase) {
  const fixtures = resolve(dirname(testInfo.file), "fixtures");
  const { content } = journey;
  const sceneIds = expectedSceneIds(content);
  const captionless = content.photos.findIndex((_photo, index) => !content.captions[index]);
  const creator = recordAnalyticsEvents(page);

  // 1. A complete draft with captioned photos, created by a visitor.
  const publicId = await createMemoryBoxDraft(page);
  const record: E2eRecord = { publicId };
  records.push(record);
  const giftRef = giftRefOf(await findGiftId(publicId));
  giftRefs.push(giftRef);
  await fillCompleteMemoryBox(page, publicId, fixtures, content);
  for (const [inputId, counter] of journey.maxedCounters) {
    await expect(page.locator(`#${inputId}-counter`)).toHaveText(counter);
  }
  if (content.captions[0]) {
    expect(await page.getByLabel("Chú thích ảnh 1").inputValue()).toBe(content.captions[0]);
  }
  const assetIds = await listDraftAssetIds(page, publicId);
  expect(assetIds).toHaveLength(content.photos.length);

  // 2. The preview lists no issue, and plays to its end without any funnel event.
  await studioStep(page, /Xem trước/).click();
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("Không phát hiện vấn đề nào.")).toBeVisible();
  // Event before a navigation: sent with `keepalive` just before the Studio left for the preview.
  await readAnalyticsEvents(giftRef, (events) =>
    events.some((event) => event.name === "preview_started"),
  );
  const previewOpen = page.getByRole("button", { name: "Mở quà" });
  await waitForHydration(previewOpen);
  await previewOpen.click();
  const preview = await playScenes(page, async () => {
    expect(await viewerFrame(page).locator("b").count()).toBe(0);
  });
  expect(preview.scenes.map((entry) => entry.sceneId)).toEqual(sceneIds);
  await page.goto(`/studio/${publicId}?step=publish`);

  // 3. An anonymous draft cannot be published.
  const publishRegion = page.getByRole("region", { name: "Xuất bản" });
  const publishButton = publishRegion.getByRole("button", { name: "Xuất bản", exact: true });
  await expect(publishButton).toBeDisabled();
  await expect(
    publishRegion.getByText("Đăng nhập và lưu quà vào tài khoản để xuất bản."),
  ).toBeVisible();

  // 4. Sign in through the magic link: back in this browser, the Studio claims the draft itself.
  const signIn = publishRegion.getByRole("link", { name: "Đăng nhập để xuất bản" });
  await waitForHydration(signIn);
  await signIn.click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  const email = uniqueE2eEmail(`publish-${journey.name}`, testInfo);
  record.email = email;
  await signInThroughMagicLink(page, email);
  await expect(page).toHaveURL(new RegExp(`/studio/${publicId}`));
  await expect(page.getByText("Bản nháp đã được bảo vệ bởi tài khoản của bạn.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu bản nháp vào tài khoản" })).toHaveCount(0);
  await studioStep(page, /Xuất bản/).click();
  await expect(publishButton).toBeEnabled();

  // 5. Publish, capturing the request, and see the published panel, also after a reload.
  const publishRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/gifts/${publicId}/publish`) && request.method() === "POST",
  );
  await waitForHydration(publishButton);
  await publishButton.click();
  // Publishing is irreversible, so it asks first; the confirmation itself sends nothing.
  await expect(publishRegion.getByRole("heading", { name: "Xuất bản món quà này?" })).toBeFocused();
  await publishRegion.getByRole("button", { name: "Xác nhận xuất bản" }).click();
  const request = await publishRequest;
  const idempotencyKey = request.headers()["idempotency-key"] ?? "";
  const requestBody = request.postData() ?? "";
  expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Đã xuất bản" })).toBeVisible();
  // The refreshed page shows the published gift alone: no draft ownership aside or claim action.
  await expect(page.getByText("Quyền sở hữu")).toHaveCount(0);
  const shareField = page.getByRole("textbox", { name: "Đường dẫn món quà" });
  await expect(shareField).toHaveValue(/\/g\/[A-Za-z0-9_-]{22}$/);
  const shareUrl = await shareField.inputValue();
  const shareId = shareUrl.slice(-22);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Đã xuất bản" })).toBeVisible();
  await expect(shareField).toHaveValue(shareUrl);

  // The creator funnel: each step once, one pseudonym, every answer 204, no path as referrer.
  await creator.settled();
  expect(countByName(creator.names())).toEqual(
    Object.fromEntries(CREATOR_EVENTS.map((name) => [name, 1])),
  );
  for (const event of creator.events) {
    // `preview_started` leaves with `keepalive` while the page navigates, so the browser may not
    // report its answer; the stored event (step 2) proves that it arrived.
    if (event.body["name"] !== "preview_started" || event.status !== null) {
      expect(event.status, `status of ${event.body["name"]}`).toBe(204);
    }
    expect(event.body).toEqual(
      expect.objectContaining({ giftRef, templateId: "memory-box", templateVersion: "1.1.0" }),
    );
    expect(event.referer ?? "").not.toContain(publicId);
  }
  expect(giftRef).not.toContain(publicId);
  expect(giftRef).not.toContain(shareId);
  const creatorSessions = new Set(creator.events.map((event) => event.body["sessionId"]));
  expect(creatorSessions.size).toBe(1);

  // 6. The same key and body replay the publication; another body conflicts.
  const headers = { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
  const path = `/api/gifts/${publicId}/publish`;
  const replay = await ownerFetch(page, { body: requestBody, headers, method: "POST", path });
  expect(replay.status).toBe(201);
  expect(
    (replay.body as { data: { publication: { shareId: string } } }).data.publication.shareId,
  ).toBe(shareId);
  const expectedRevision = (JSON.parse(requestBody) as { expectedRevision: number })
    .expectedRevision;
  const conflicting = await ownerFetch(page, {
    body: JSON.stringify({ expectedRevision: expectedRevision + 1 }),
    headers,
    method: "POST",
    path,
  });
  expect(conflicting.status).toBe(409);
  // The server records `gift_published` after the response, once, without a browser session.
  const afterPublish = await readAnalyticsEvents(giftRef, (events) =>
    events.some((event) => event.name === "gift_published"),
  );
  const published = afterPublish.filter((event) => event.name === "gift_published");
  expect(published).toHaveLength(1);
  expect(published[0]?.sessionId).toBeNull();
  // A late duplicate from the replay would land after the first write: count again after a settle.
  await page.waitForTimeout(1_500);
  const settled = await readAnalyticsEvents(giftRef);
  expect(settled.filter((event) => event.name === "gift_published")).toHaveLength(1);

  // 7. Draft access has ended: no draft read and no photo deletion.
  const draftRead = await ownerFetch(page, { method: "GET", path: `/api/gifts/${publicId}` });
  expect(draftRead.status).toBe(404);
  const photoDelete = await ownerFetch(page, {
    body: JSON.stringify({ giftPublicId: publicId }),
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
    path: `/api/media/assets/${assetIds[0]}`,
  });
  expect(photoDelete.status).toBe(404);

  // 8. A recipient without cookies: protected headers, generic title, no content before the tap.
  const recipient = await recipientContext(page);
  try {
    const guest = await recipient.newPage();
    const recipientEvents = recordAnalyticsEvents(guest);
    const payloadRequests: string[] = [];
    guest.on("request", (sent) => {
      if (sent.url().includes("/api/public-gifts/")) payloadRequests.push(sent.url());
    });
    const response = await guest.goto(shareUrl);
    expect(response?.status()).toBe(200);
    const pageHeaders = response?.headers() ?? {};
    expect(pageHeaders["cache-control"]).toContain("private");
    expect(pageHeaders["cache-control"]).toContain("no-store");
    expect(pageHeaders["x-robots-tag"]).toBe("noindex");
    expect(pageHeaders["referrer-policy"]).toBe("no-referrer");
    expect(pageHeaders["content-security-policy"]).toContain("'strict-dynamic'");
    await expect(guest).toHaveTitle("Một món quà dành cho bạn · LoveMemory");
    const html = (await response?.text()) ?? "";
    for (const secret of [
      ...textValues(journey).filter((value) => value.length >= 4),
      ...assetIds,
      "/api/local-object-storage/",
      "/audio-library/",
    ]) {
      expect(html).not.toContain(secret);
    }
    const open = guest.getByRole("button", { name: "Mở quà" });
    await waitForHydration(open);
    await expectMinimumTarget(open, "Mở quà");
    // No frame exists before the tap: the host only.
    expect(
      await hostOverflow(guest),
      "host horizontal overflow on the envelope",
    ).toBeLessThanOrEqual(0);
    await captureViewerScreenshot(
      guest.locator("[data-public-gift]"),
      testInfo,
      `${journey.name}-published-envelope`,
    );
    expect(payloadRequests).toEqual([]);
    expect(recipientEvents.events).toEqual([]);

    // 9. `Mở quà` loads the snapshot once and plays it to the end, scene by scene.
    await open.click();
    await expect(guest.locator(`iframe[title="${VIEWER_TITLE}"]`)).toHaveAttribute(
      "src",
      /\/template-artifacts\/memory-box\/1\.1\.0\//,
    );
    const frame = viewerFrame(guest);
    const captures: Record<string, string> = {
      letter: "letter",
      "memory-1": "memory-1",
      opening: "opening",
      ...(captionless === -1 ? {} : { [`memory-${captionless + 1}`]: "memory-without-caption" }),
    };
    const recipientPlay = await playScenes(guest, async (sceneId) => {
      await expectNoHorizontalOverflow(guest, sceneId);
      expect(await frame.locator("b").count(), `markup rendered in ${sceneId}`).toBe(0);
      if (sceneId !== "finale") await expectNextInsideFrame(frame, sceneId);
      if (sceneId === "memory-1") {
        await expect
          .poll(() => naturalWidth(scene(frame, "memory-1").locator("img")), { timeout: 15_000 })
          .toBeGreaterThan(0);
      }
      const capture = captures[sceneId];
      if (capture) {
        await captureFrozenScene(guest, testInfo, sceneId, `${journey.name}-published-${capture}`);
      }
    });
    // The finale completes on its own; captured once the template reports `COMPLETE`.
    await expect(frame.locator("body")).toHaveAttribute("data-state", "complete");
    await expect(scene(frame, "finale")).toBeVisible();
    await captureViewerScreenshot(
      guest.locator("[data-public-gift]"),
      testInfo,
      `${journey.name}-published-finale`,
    );
    await expect(scene(frame, "finale")).toBeVisible();
    expect(payloadRequests).toHaveLength(1);

    // Preview and published show the same content (Gate M2).
    expect(recipientPlay.masthead).toBe(preview.masthead);
    expect(recipientPlay.scenes).toEqual(preview.scenes);
    if (content.captions[0]) {
      expect(recipientPlay.scenes.find((entry) => entry.sceneId === "memory-1")?.text).toContain(
        content.captions[0],
      );
    }

    // The recipient funnel: nothing before the tap, then each step once, in order.
    await expect
      .poll(() => recipientEvents.names().includes("gift_completed"), { timeout: 10_000 })
      .toBe(true);
    await recipientEvents.settled();
    expect(
      recipientEvents.events.map((event) =>
        event.body["sceneId"]
          ? `${event.body["name"]}:${event.body["sceneId"]}`
          : event.body["name"],
      ),
    ).toEqual([
      "gift_open_interaction",
      ...sceneIds.map((sceneId) => `scene_completed:${sceneId}`),
      "gift_completed",
    ]);
    const baseUrl = new URL(shareUrl).origin;
    for (const event of recipientEvents.events) {
      expect(event.status, `status of ${event.body["name"]}`).toBe(204);
      // Event from a no-referrer page: the real origin, not `null`.
      expect(event.origin).toBe(baseUrl);
      expect(event.body["giftRef"]).toBe(giftRef);
      expect(creatorSessions.has(event.body["sessionId"])).toBe(false);
    }
  } finally {
    await recipient.close();
  }

  // 10. Gate M2: a broken template never hides the core content.
  const fallbackContext = await recipientContext(page);
  try {
    const guest = await fallbackContext.newPage();
    const fallbackEvents = recordAnalyticsEvents(guest);
    await guest.route("**/template-artifacts/**", (route) => route.abort());
    await guest.goto(shareUrl);
    const open = guest.getByRole("button", { name: "Mở quà" });
    await waitForHydration(open);
    await open.click();
    const fallback = guest.getByRole("region", { name: "Nội dung món quà" });
    await expect(fallback).toBeVisible({ timeout: 30_000 });
    const shown = await fallback.innerText();
    for (const value of textValues(journey)) {
      expect(shown, `fallback shows ${value.slice(0, 24)}`).toContain(value);
    }
    await expect(fallback.locator("img")).toHaveCount(content.photos.length);
    await expect
      .poll(() => naturalWidth(fallback.locator("img").first()), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await captureViewerScreenshot(
      guest.locator("[data-public-gift]"),
      testInfo,
      `${journey.name}-published-fallback`,
    );
    // The region scrolls, and its last block can be reached.
    const lastBlock = fallback.locator("div > :last-child").last();
    await fallback.evaluate((region) => region.scrollTo({ top: region.scrollHeight }));
    await expect(lastBlock).toBeInViewport();
    expect(
      await hostOverflow(guest),
      "host horizontal overflow in the fallback",
    ).toBeLessThanOrEqual(0);
    await fallbackEvents.settled();
    expect(fallbackEvents.names()).toEqual(["gift_open_interaction"]);

    // 11. An unknown share link: the opaque not-found page with a real 404, and a 404 from the API.
    const unknown = randomBytes(16).toString("base64url");
    const missing = await guest.goto(`/g/${unknown}`);
    await expect(guest.getByText("Món quà không tồn tại hoặc đã được thu hồi.")).toBeVisible();
    expect(missing?.status()).toBe(404);
    expect(missing?.headers()["x-robots-tag"]).toBe("noindex");
    expect(missing?.headers()["cache-control"]).toContain("no-store");
    expect(missing?.headers()["referrer-policy"]).toBe("no-referrer");
    const apiMissing = await guest.request.get(`/api/public-gifts/${unknown}`);
    expect(apiMissing.status()).toBe(404);
    await fallbackEvents.settled();
    expect(fallbackEvents.names()).toEqual(["gift_open_interaction"]);
  } finally {
    await fallbackContext.close();
  }

  // 12. The stored funnel: every step under one pseudonym, nine keys, 180 days, nothing personal.
  const expectedCounts: Record<string, number> = {
    ...Object.fromEntries(CREATOR_EVENTS.map((name) => [name, 1])),
    gift_completed: 1,
    gift_open_interaction: 2,
    gift_published: 1,
    scene_completed: sceneIds.length,
  };
  const total = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0);
  const stored = await readAnalyticsEvents(giftRef, (events) => events.length >= total);
  expect(countByName(stored.map((event) => event.name))).toEqual(expectedCounts);
  const secrets = [publicId, shareId, ...textValues(journey), ...assetIds];
  for (const event of stored) {
    expect(Object.keys(event).sort()).toEqual(STORED_EVENT_KEYS);
    expect(event.expiresAt.getTime() - event.occurredAt.getTime()).toBe(RETENTION_MILLISECONDS);
    expect(event.sceneId === null).toBe(event.name !== "scene_completed");
    const serialized = JSON.stringify(event);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  }
  expect(RECIPIENT_EVENTS.every((name) => !creator.names().includes(name))).toBe(true);
}

for (const journey of JOURNEYS) {
  test(`publishes a Memory Box gift (${journey.name}) and opens it by share link in an anonymous browser`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(journey.name === "typical" ? 300_000 : 480_000);
    await runPublishJourney(page, testInfo, journey);
  });
}
