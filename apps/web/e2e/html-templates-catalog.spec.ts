import { type FrameLocator, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";

import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  type E2eRecord,
  saveStatus,
  studioStep,
  waitForHydration,
} from "./support/gift-journey";
import { assignOwnAuthClientAddress, expect, test } from "./test";

// `add-animation-gift-templates`: the six bundled html templates in the catalog with their own
// thumbnails, a smoke test of each artifact opened directly, and one full `memories` journey from
// the catalog to the recipient's `/g/{shareId}`.

const VIEWER_TITLE = "LoveMemory template viewer";
const ARTIFACT = /^\/template-artifacts\/[a-z-]+\/1\.0\.0\/[a-f0-9]{64}\//;

/** Each bundled template with a text its defaults render once its scripts ran. */
const TEMPLATES = [
  { id: "love-days", name: "Trái tim yêu thương", selector: "#n1", text: "Thiên Minh" },
  { id: "envelope-letter", name: "Thư tay", selector: "#cardTitle", text: "người thương" },
  {
    id: "galaxy-text",
    name: "Thông điệp giữa ngân hà",
    selector: "#gTitle",
    text: "Có điều này anh muốn nói…",
  },
  // Its messages are drawn on canvas: its script sizes the canvas to the window (see below).
  { id: "heart-photo", name: "Trái tim kỉ niệm", selector: "#cv", text: "" },
  {
    id: "matrix-text",
    name: "Lời nhắn ma trận",
    selector: "#heartText",
    text: "Anh sẽ luôn bên em",
  },
  {
    id: "memories",
    name: "Kỷ niệm của chúng mình",
    selector: "#introTitle",
    text: "Happy Anniversary",
  },
] as const;

test.use({ actionTimeout: 20_000 });

const records: E2eRecord[] = [];

test.afterEach(async () => {
  await Promise.all(records.splice(0).map(cleanupE2eRecord));
});

function viewerFrame(page: Page): FrameLocator {
  return page.frameLocator(`iframe[title="${VIEWER_TITLE}"]`);
}

/** The thumbnail of a catalog card: its picture, loaded from the template's own artifact. */
async function thumbnailPath(page: Page, name: string): Promise<string> {
  const card = page.getByRole("article").filter({ hasText: name });
  await expect(card.getByText("Sắp ra mắt")).toHaveCount(0);
  const image = card.getByRole("img", { name: `Hình minh họa mẫu quà ${name}` });
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth))
    .toBeGreaterThan(0);
  return new URL((await image.getAttribute("src")) ?? "", page.url()).pathname;
}

/** A same-origin test page that frames an artifact like the gift page: sandboxed, INIT then PLAY. */
const HOST_PATH = "/__e2e-html-template-host";

function hostDocument(artifactPath: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe title="artifact" sandbox="allow-scripts" src="${artifactPath}"></iframe><script>
const frame = document.querySelector("iframe");
window.received = [];
window.send = (message) => frame.contentWindow.postMessage(message, "*");
let ready = false;
addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  window.received.push(event.data);
  if (event.data && event.data.type === "READY" && !ready) { ready = true; window.send({ type: "PLAY" }); }
});
frame.addEventListener("load", () => {
  const init = { assets: {}, context: { locale: "vi-VN", prefersReducedMotion: false }, payload: {}, protocolVersion: 1, type: "INIT" };
  const timer = setInterval(() => { if (ready) clearInterval(timer); else window.send(init); }, 100);
});
</script></body></html>`;
}

/** Frames the artifact of a bundled template in the test host; resolves once it answered READY. */
async function openFramed(page: Page, name: string): Promise<string> {
  await page.goto("/templates");
  const artifactPath = (await thumbnailPath(page, name)).replace(
    "assets/thumbnail.jpg",
    "index.html",
  );
  await page.route(`**${HOST_PATH}`, (route) =>
    route.fulfill({ body: hostDocument(artifactPath), contentType: "text/html" }),
  );
  await page.goto(HOST_PATH);
  await expect.poll(() => received(page)).toContainEqual({ protocolVersion: 1, type: "READY" });
  return artifactPath;
}

function received(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { received: unknown[] }).received);
}

async function send(page: Page, message: Readonly<Record<string, unknown>>): Promise<void> {
  await page.evaluate(
    (data) => (window as unknown as { send: (message: unknown) => void }).send(data),
    message,
  );
}

const RUNTIME_ERROR = { code: "RUNTIME_ERROR", type: "ERROR" };

test("lists the six html templates with their own thumbnails", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.goto("/templates");

  for (const template of TEMPLATES) {
    const path = await thumbnailPath(page, template.name);
    expect(path).toMatch(ARTIFACT);
    expect(path).toContain(`/template-artifacts/${template.id}/1.0.0/`);
    expect(path.endsWith("/assets/thumbnail.jpg")).toBe(true);
  }
  // `memory-box`, an sdk template, keeps its gradient and icon.
  await expect(
    page.getByRole("article").filter({ hasText: "Hộp ký ức" }).getByRole("img"),
  ).toHaveCount(0);

  const response = await page.request.get(await thumbnailPath(page, "Thư tay"));
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/jpeg");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  await page.goto("/templates/memories");
  const detail = page.getByRole("img", { name: "Hình minh họa mẫu quà Kỷ niệm của chúng mình" });
  await expect
    .poll(() => detail.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText("1–15 ảnh")).toBeVisible();
  expect(violations).toEqual([]);
});

test("opens each html template's artifact with its defaults and no error", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/templates");
  const artifacts: string[] = [];
  for (const template of TEMPLATES) {
    artifacts.push(
      (await thumbnailPath(page, template.name)).replace("assets/thumbnail.jpg", "index.html"),
    );
  }

  for (const [index, template] of TEMPLATES.entries()) {
    const errors: string[] = [];
    const failed: string[] = [];
    const tab = await page.context().newPage();
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    tab.on("requestfailed", (request) => failed.push(request.url()));
    await tab.setViewportSize({ height: 844, width: 390 });
    const response = await tab.goto(artifacts[index] ?? "");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"]).toContain("sandbox allow-scripts");

    if (template.id === "heart-photo") {
      // The script sized the canvas to the window at its device pixel ratio (at most 2), and
      // split the default message `Happy|Anniversary` into two lines.
      await expect
        .poll(() =>
          tab.evaluate(() => {
            const canvas = document.querySelector("canvas");
            if (!canvas) return false;
            const ratio = Math.min(2, window.devicePixelRatio || 1);
            return canvas.width === Math.round(canvas.clientWidth * ratio) && canvas.width > 300;
          }),
        )
        .toBe(true);
      expect(await tab.evaluate("texts.map((text) => text.lines)")).toEqual([
        ["Happy", "Anniversary"],
        ["Anh 💗 Em"],
        ["Mãi bên nhau 🤍"],
      ]);
    } else {
      await expect(tab.locator(template.selector)).toContainText(template.text);
    }
    if (template.id === "memories") {
      // Without a passcode (the default), the opening heart leads straight to the menu.
      await tab.locator("#startBtn").click();
      await expect(tab.locator("#s-home")).toHaveClass(/active/);
      await expect(tab.locator("#s-lock")).not.toHaveClass(/active/);
      await expect(tab.locator('#menu [data-go="gallery"]')).toBeVisible();
    }
    // The bundled fonts load from the artifact: nothing reaches Google Fonts or another origin.
    await expect
      .poll(() =>
        tab.evaluate(async () => {
          await document.fonts.ready;
          return Array.from(document.fonts).some((face) => face.status === "loaded");
        }),
      )
      .toBe(true);
    await tab.waitForTimeout(1_500);
    expect(errors, template.id).toEqual([]);
    expect(failed, template.id).toEqual([]);
    await tab.close();
  }
});

test("creates, previews and publishes a memories gift that opens with its passcode", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const fixtures = resolve(dirname(testInfo.file), "fixtures");
  const email = uniqueE2eEmail("html-templates", testInfo);
  const CAPTION = "Biển <b>Nha Trang</b>";

  // 1. Signed in, the creator picks `memories` from the catalog.
  await page.goto(`/auth/sign-in?next=${encodeURIComponent("/templates")}`);
  await signInThroughMagicLink(page, email);
  await expect(page).toHaveURL(/\/templates$/);
  const card = page.getByRole("article").filter({ hasText: "Kỷ niệm của chúng mình" });
  await expect(card.getByText("1–15 ảnh")).toBeVisible();
  await card.getByRole("link", { name: "Xem câu chuyện" }).click();
  await expect(page).toHaveURL(/\/templates\/memories$/);
  await page.getByRole("link", { name: "Dùng template này" }).click();
  const start = page.getByRole("button", { name: "Bắt đầu với template này" });
  await waitForHydration(start);
  await start.click();
  await expect(page).toHaveURL(/\/studio\/[A-Za-z0-9_-]{24}/);
  const publicId = new URL(page.url()).pathname.split("/").pop() ?? "";
  records.push({ email, publicId });

  // 2. The couple, a playful passcode, one captioned album photo and a two-paragraph letter.
  const date = page.getByLabel("Ngày bắt đầu yêu");
  await waitForHydration(date);
  await date.fill("2024-02-14");
  await page.getByRole("textbox", { name: "Tên (hoặc biệt danh) của cô ấy" }).fill("Minh Thư");
  await page.getByRole("textbox", { name: "Tên (hoặc biệt danh) của anh ấy" }).fill("Hoàng");

  await studioStep(page, /Mật mã/).click();
  await page.getByLabel("Mật mã vui (4 số)").fill("1402");
  await page.getByRole("textbox", { name: "Tiêu đề màn hình mật mã" }).fill("HOÀNG & THƯ");

  await studioStep(page, /Kỷ niệm/).click();
  const picker = page.locator('input#studio-field-gallery[type="file"]');
  await expect(picker).toBeEnabled();
  await picker.setInputFiles(resolve(fixtures, "photo-2.jpg"));
  await page
    .getByRole("dialog", { name: "Cắt ảnh theo khung mẫu quà" })
    .getByRole("button", { name: "Dùng vùng ảnh này" })
    .click();
  await expect(
    page.locator('img[alt="Ảnh kỷ niệm đã tải"][src*="/api/local-object-storage/"]'),
  ).toHaveCount(1, { timeout: 45_000 });
  await page.getByLabel("Chú thích ảnh 1").fill(CAPTION);

  await studioStep(page, /Lá thư/).click();
  await page.getByRole("textbox", { name: "Nội dung lá thư 1" }).fill("Gửi Thư,");
  await page.getByRole("button", { name: "Thêm dòng" }).click();
  await page.getByRole("textbox", { name: "Nội dung lá thư 2" }).fill("Thương em nhiều lắm.");
  await page.getByRole("textbox", { exact: true, name: "Chữ ký" }).fill("Hoàng");
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 15_000 });

  // 3. The preview runs the template with the draft's values and lists no issue.
  await studioStep(page, /Xem trước/).click();
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("Không phát hiện vấn đề nào.")).toBeVisible();
  await expect(page.locator(`iframe[title="${VIEWER_TITLE}"]`)).toHaveAttribute(
    "src",
    /\/template-artifacts\/memories\/1\.0\.0\/[a-f0-9]{64}\/index\.html$/,
  );
  const previewOpen = page.getByRole("button", { name: "Mở quà" });
  await waitForHydration(previewOpen);
  await previewOpen.click();
  await expect(viewerFrame(page).locator("#introTitle")).toHaveText("Happy Anniversary");

  // 4. Publish on Free (one photo).
  await page.goto(`/studio/${publicId}?step=publish`);
  const publishRegion = page.getByRole("region", { name: "Xuất bản" });
  await expect(publishRegion.getByRole("radio", { name: /^Miễn phí/ })).toBeChecked();
  const publishButton = publishRegion.getByRole("button", { name: "Xuất bản", exact: true });
  await expect(publishButton).toBeEnabled();
  await waitForHydration(publishButton);
  await publishButton.click();
  await publishRegion.getByRole("checkbox").check();
  await publishRegion.getByRole("button", { name: "Xác nhận xuất bản" }).click();
  await expect(page.getByRole("heading", { name: "Đã xuất bản" })).toBeVisible();
  const shareUrl = await page.getByRole("textbox", { name: "Đường dẫn món quà" }).inputValue();

  // 5. The recipient opens the gift, unlocks it with the passcode and finds the creator's values.
  const recipient = await browser.newContext({ viewport: { height: 844, width: 390 } });
  await assignOwnAuthClientAddress(recipient);
  try {
    const guest = await recipient.newPage();
    const errors: string[] = [];
    guest.on("pageerror", (error) => errors.push(error.message));
    await guest.goto(new URL(shareUrl).pathname);
    const open = guest.getByRole("button", { name: "Mở quà" });
    await waitForHydration(open);
    await open.click();
    const frame = viewerFrame(guest);
    await frame.locator("#startBtn").click();
    await expect(frame.locator("#lockNames")).toHaveText("HOÀNG & THƯ");
    const pins = frame.locator("#pins input");
    await expect(pins).toHaveCount(4);
    for (const [index, digit] of [..."0000"].entries()) await pins.nth(index).fill(digit);
    await expect(frame.locator("#lockMsg")).toHaveText("Sai rồi, thử lại nha ♡");
    await expect(pins.first()).toHaveValue("");
    for (const [index, digit] of [..."1402"].entries()) await pins.nth(index).fill(digit);
    await expect(frame.locator("#menu")).toBeVisible();

    await frame.locator('[data-go="days"]').click();
    await expect(frame.locator("#nameHer")).toHaveText("Minh Thư");
    await expect(frame.locator("#nameHim")).toHaveText("Hoàng");
    await expect(frame.locator("#startTxt")).toHaveText("14/02/2024");
    await frame.locator("#s-days [data-back]").click();

    await frame.locator('[data-go="gallery"]').click();
    // The caption is text: its markup characters are shown, and no element is created.
    await expect(frame.locator("#grid .tile p").first()).toHaveText(CAPTION);
    await expect(frame.locator("#grid b")).toHaveCount(0);
    const photo = frame.locator("#grid .tile img").first();
    await expect(photo).toHaveAttribute("src", /\/api\/local-object-storage\//);
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    // The album photos are keyboard buttons: Enter opens one, Escape closes it again.
    const tile = frame.locator("#grid .tile").first();
    await expect(tile).toHaveAttribute("role", "button");
    await tile.focus();
    await tile.press("Enter");
    await expect(frame.locator("#lightbox")).toHaveClass(/show/);
    await expect(frame.locator("#lbCap")).toHaveText(CAPTION);
    await tile.press("Escape");
    await expect(frame.locator("#lightbox")).not.toHaveClass(/show/);
    await expect(tile).toBeFocused();
    await frame.locator("#s-gallery [data-back]").click();

    await frame.locator('[data-go="letter"]').click();
    await frame.locator("#env").click();
    await expect(frame.locator("#envTip")).toHaveText("chạm vào thư để đọc nha ♡");
    await frame.locator("#env").click();
    await expect(frame.locator("#paper")).toContainText("Gửi Thư,");
    await expect(frame.locator("#paper")).toContainText("Thương em nhiều lắm.");
    await expect(frame.locator("#paper .sign")).toContainText("Hoàng");
    expect(errors).toEqual([]);
  } finally {
    await recipient.close();
  }
});

test.describe("html template artifacts in a sandboxed frame", () => {
  test("reports a promise rejected while the scripts start as RUNTIME_ERROR, and nothing more", async ({
    page,
  }) => {
    // The template's first script, served from the artifact origin like the real one.
    await page.route("**/template-artifacts/love-days/**/script-1.js", (route) =>
      route.fulfill({
        body: 'Promise.reject(new Error("e2e rejected gift text"));',
        contentType: "text/javascript; charset=utf-8",
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
    );
    await openFramed(page, "Trái tim yêu thương");

    await expect.poll(() => received(page)).toContainEqual(RUNTIME_ERROR);
    expect(JSON.stringify(await received(page))).not.toContain("e2e rejected gift text");
  });

  test("reports a promise rejected by a late onload handler as RUNTIME_ERROR", async ({ page }) => {
    // `window.onload` set after the document loaded runs in a later task of the bootstrap; the
    // browser reports its rejection in yet another task.
    await page.route("**/template-artifacts/love-days/**/script-1.js", (route) =>
      route.fulfill({
        body: 'window.onload = () => Promise.reject(new Error("e2e late rejection"));',
        contentType: "text/javascript; charset=utf-8",
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
    );
    await openFramed(page, "Trái tim yêu thương");

    await expect.poll(() => received(page)).toContainEqual(RUNTIME_ERROR);
    expect(JSON.stringify(await received(page))).not.toContain("e2e late rejection");
  });

  test("keeps the envelope closed while the gift page is hidden (Hidden gift page)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openFramed(page, "Thư tay");
    // Hidden right after `Mở quà`: the auto-open (after about 4.7 s) must wait for `PLAY`.
    await send(page, { type: "PAUSE" });
    const envelope = page.frameLocator('iframe[title="artifact"]').locator("#env");
    await expect(envelope).toHaveClass("envelope");
    await page.waitForTimeout(7_000);
    await expect(envelope).toHaveClass("envelope");

    await send(page, { type: "PLAY" });
    await expect(envelope).toHaveClass(/\bopen\b/, { timeout: 10_000 });
    expect(await received(page)).not.toContainEqual(RUNTIME_ERROR);
  });

  test("starts heart-photo even when its font fails to load (Font that fails to load)", async ({
    page,
  }) => {
    await page.route("**/template-artifacts/heart-photo/**/*.woff2", (route) => route.abort());
    const artifactPath = await openFramed(page, "Trái tim kỉ niệm");

    const frame = page.frames().find((candidate) => candidate.url().endsWith(artifactPath));
    if (!frame) throw new Error("The heart-photo frame is missing.");
    await expect
      .poll(() => frame.evaluate("typeof started !== 'undefined' && started"), { timeout: 10_000 })
      .toBe(true);
    expect(await received(page)).not.toContainEqual(RUNTIME_ERROR);
  });
});
