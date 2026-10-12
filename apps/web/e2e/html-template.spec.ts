import { type FrameLocator, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  type E2eRecord,
  saveStatus,
  studioStep,
  waitForHydration,
} from "./support/gift-journey";
import { assignOwnAuthClientAddress, expect, test } from "./test";

// `add-html-template-kind`: the bundled `love-days` html template, imported by `db:seed` into the
// E2E database and the local object storage of the Playwright web server, from the catalog to the
// recipient's `/g/{shareId}`.

const VIEWER_TITLE = "LoveMemory template viewer";
const CONTENT = {
  caption: "Cảm ơn vì đã ở bên anh",
  date: "2023-08-14",
  dateShown: "14/08/2023",
  first: "Minh Thư",
  second: "Hoàng",
} as const;

test.use({ actionTimeout: 20_000 });

const records: E2eRecord[] = [];

test.afterEach(async () => {
  await Promise.all(records.splice(0).map(cleanupE2eRecord));
});

function viewerFrame(page: Page): FrameLocator {
  return page.frameLocator(`iframe[title="${VIEWER_TITLE}"]`);
}

/** The text of the QR code in a PNG file, decoded in the test process. */
async function decodeQrPng(
  path: string,
): Promise<{ height: number; text: string | undefined; width: number }> {
  const { data, info } = await sharp(await readFile(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  return {
    height: info.height,
    text: jsQR(pixels, info.width, info.height)?.data,
    width: info.width,
  };
}

test("creates, previews and publishes a love-days gift that opens with the creator's values", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixtures = resolve(dirname(testInfo.file), "fixtures");
  const email = uniqueE2eEmail("html-template", testInfo);

  // 1. Signed in, the creator picks the html template from the catalog.
  await page.goto(`/auth/sign-in?next=${encodeURIComponent("/templates")}`);
  await signInThroughMagicLink(page, email);
  await expect(page).toHaveURL(/\/templates$/);
  const card = page.getByRole("article").filter({ hasText: "Trái tim yêu thương" });
  await expect(card.getByText("Sắp ra mắt")).toHaveCount(0);
  await expect(card.getByText("1–3 ảnh")).toBeVisible();
  await card.getByRole("link", { name: "Xem câu chuyện" }).click();
  await expect(page).toHaveURL(/\/templates\/love-days$/);
  await page.getByRole("link", { name: "Dùng template này" }).click();
  await expect(page).toHaveURL(/\/studio\/new\?template=love-days$/);
  await expect(
    page.getByRole("heading", { name: "Bắt đầu với Trái tim yêu thương" }),
  ).toBeVisible();
  const start = page.getByRole("button", { name: "Bắt đầu với template này" });
  await waitForHydration(start);
  await start.click();
  await expect(page).toHaveURL(/\/studio\/[A-Za-z0-9_-]{24}/);
  const publicId = new URL(page.url()).pathname.split("/").pop() ?? "";
  records.push({ email, publicId });

  // 2. The Studio steps of the manifest, with its date, names, photo and caption.
  const date = page.getByLabel("Ngày bắt đầu yêu");
  await waitForHydration(date);
  await date.fill(CONTENT.date);
  await page.getByRole("textbox", { name: "Tên người thứ nhất" }).fill(CONTENT.first);
  await page.getByRole("textbox", { name: "Tên người thứ hai" }).fill(CONTENT.second);

  await studioStep(page, /Bất ngờ/).click();
  const picker = page.locator('input#studio-field-photo[type="file"]');
  await expect(picker).toBeEnabled();
  await picker.setInputFiles(resolve(fixtures, "photo.jpg"));
  await page
    .getByRole("dialog", { name: "Cắt ảnh theo khung mẫu quà" })
    .getByRole("button", { name: "Dùng vùng ảnh này" })
    .click();
  await expect(
    page.locator('img[alt="Ảnh kỷ niệm đã tải"][src*="/api/local-object-storage/"]'),
  ).toHaveCount(1, { timeout: 45_000 });
  await expect(picker).toBeDisabled();
  await page.getByRole("textbox", { name: "Lời nhắn dưới ảnh" }).fill(CONTENT.caption);
  await expect(saveStatus(page)).toHaveText("Đã lưu", { timeout: 15_000 });

  // 3. The preview runs the template with the draft's values and lists no issue.
  await studioStep(page, /Xem trước/).click();
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(page).toHaveURL(/\/preview\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("Không phát hiện vấn đề nào.")).toBeVisible();
  const previewFrame = page.locator(`iframe[title="${VIEWER_TITLE}"]`);
  await expect(previewFrame).toHaveAttribute(
    "src",
    /\/template-artifacts\/love-days\/1\.0\.0\/[a-f0-9]{64}\/index\.html$/,
  );
  const artifactPath = (await previewFrame.getAttribute("src")) ?? "";
  // The template's scripts wait for the opening gesture (`PLAY`), behind the envelope.
  await expect(viewerFrame(page).locator("#n1")).toHaveText("");
  const previewOpen = page.getByRole("button", { name: "Mở quà" });
  await waitForHydration(previewOpen);
  await previewOpen.click();
  await expect(viewerFrame(page).locator("#n1")).toHaveText(CONTENT.first);

  // 4. Publish on Free.
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
  expect(shareUrl).toMatch(/\/g\/[A-Za-z0-9_-]{22}$/);

  // 4b. `add-gift-qr-codes`: the share URL as a QR code in three styles, downloaded as PNG that
  // decodes back to the share URL, and as SVG.
  const qr = page.getByRole("region", { name: "Mã QR" });
  // The preview becomes the style's PNG as a data: URL, so a long press saves it on a phone,
  // in-app browsers included.
  await expect(qr.getByRole("img", { name: "Mã QR mở món quà, kiểu Cơ bản" })).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  // From here on, generating, switching and downloading make no network request.
  const qrRequests: string[] = [];
  const recordRequest = (request: { url: () => string }) => {
    qrRequests.push(request.url());
  };
  page.on("request", recordRequest);
  await expect(
    qr.getByText("Trên điện thoại: nhấn giữ ảnh để lưu vào thư viện ảnh."),
  ).toBeVisible();
  const studioUrl = page.url();
  await qr.getByText("Khung trái tim", { exact: true }).click();
  await expect(qr.getByRole("radio", { name: "Khung trái tim" })).toBeChecked();
  await expect(
    qr.getByRole("img", { name: "Mã QR mở món quà, kiểu Khung trái tim" }),
  ).toHaveAttribute("src", /^data:image\/png;base64,/);
  const [heartPng] = await Promise.all([
    page.waitForEvent("download"),
    qr.getByRole("button", { name: "Tải PNG" }).click(),
  ]);
  expect(heartPng.suggestedFilename()).toBe("qua-tang-qr-trai-tim.png");
  await expect(decodeQrPng(await heartPng.path())).resolves.toEqual({
    height: 1024,
    text: shareUrl,
    width: 1024,
  });
  await qr.getByText("Hình nền điện thoại", { exact: true }).click();
  await expect(
    qr.getByRole("img", { name: "Mã QR mở món quà, kiểu Hình nền điện thoại" }),
  ).toBeVisible();
  const [wallpaperPng] = await Promise.all([
    page.waitForEvent("download"),
    qr.getByRole("button", { name: "Tải PNG" }).click(),
  ]);
  expect(wallpaperPng.suggestedFilename()).toBe("qua-tang-qr-hinh-nen.png");
  await expect(decodeQrPng(await wallpaperPng.path())).resolves.toEqual({
    height: 2340,
    text: shareUrl,
    width: 1080,
  });
  await qr.getByText("Cơ bản", { exact: true }).click();
  const [plainSvg] = await Promise.all([
    page.waitForEvent("download"),
    qr.getByRole("button", { name: "Tải SVG" }).click(),
  ]);
  expect(plainSvg.suggestedFilename()).toBe("qua-tang-qr.svg");
  const svg = await readFile(await plainSvg.path(), "utf8");
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1024" height="1024"/);
  expect(svg).not.toContain(shareUrl);
  // Downloads never navigate the Studio page.
  expect(page.url()).toBe(studioUrl);
  expect(page.context().pages()).toHaveLength(1);
  page.off("request", recordRequest);
  expect(qrRequests.filter((url) => !/^(data|blob):/.test(url))).toEqual([]);

  // 5. A recipient without an account opens the link: the template shows the creator's values.
  const recipient = await browser.newContext();
  await assignOwnAuthClientAddress(recipient);
  try {
    const guest = await recipient.newPage();
    const artifactResponses: string[] = [];
    guest.on("response", (response) => {
      if (response.url().includes("/template-artifacts/")) {
        artifactResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await guest.goto(new URL(shareUrl).pathname);
    const open = guest.getByRole("button", { name: "Mở quà" });
    await waitForHydration(open);
    await open.click();
    const frame = viewerFrame(guest);
    await expect(frame.locator("#n1")).toHaveText(CONTENT.first);
    await expect(frame.locator("#n2")).toHaveText(CONTENT.second);
    await expect(frame.locator("#date")).toHaveText(CONTENT.dateShown);
    await expect(frame.locator("#popCaption")).toHaveText(CONTENT.caption);
    await expect(frame.locator("#days")).toHaveText(/^\d+ DAYS$/);
    // The bundled font and the template's own scripts load from the artifact, nothing fails.
    await expect
      .poll(() =>
        frame.locator("body").evaluate(async () => {
          await document.fonts.ready;
          return Array.from(document.fonts).some(
            (face) => face.family.replace(/"/g, "") === "Patrick Hand" && face.status === "loaded",
          );
        }),
      )
      .toBe(true);
    expect(artifactResponses.every((line) => line.startsWith("200 "))).toBe(true);
    expect(artifactResponses.some((line) => line.endsWith("/love-gift.js"))).toBe(true);
    expect(artifactResponses.some((line) => line.endsWith("/script-1.js"))).toBe(true);

    // Filling the heart opens the uploaded photo, served by the signed local object route.
    const heart = frame.getByRole("button", { name: "Chạm vào trái tim" });
    for (let tap = 0; tap < 8; tap += 1) await heart.click();
    const photo = frame.locator("#frame img");
    await expect(photo).toHaveAttribute("src", /\/api\/local-object-storage\//, {
      timeout: 15_000,
    });
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);

    // 6. Opened directly as a page, the artifact runs sandboxed (an opaque origin) with its
    // defaults and its bundled font.
    const direct = await recipient.newPage();
    const response = await direct.goto(artifactPath);
    expect(response?.headers()["content-security-policy"]).toContain("sandbox allow-scripts");
    await expect(direct.locator("#n1")).toHaveText("Thiên Minh");
    expect(await direct.evaluate(() => window.origin)).toBe("null");
    await expect
      .poll(() =>
        direct.evaluate(async () => {
          await document.fonts.ready;
          return Array.from(document.fonts).some((face) => face.status === "loaded");
        }),
      )
      .toBe(true);
  } finally {
    await recipient.close();
  }
});
