import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = new URL(process.env.LIVE_SPIKE_BASE_URL ?? "http://localhost:3000");
const token = process.env.TECHNICAL_SPIKE_TOKEN;

if (!token || token.length < 24) {
  throw new Error("TECHNICAL_SPIKE_TOKEN with at least 24 characters is required.");
}

const imagePath = join(tmpdir(), `love-memory-spike-${crypto.randomUUID()}.png`);
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const authorization = { authorization: `Bearer ${token}` };
const browser = await chromium.launch();

function requireSuccessfulResponse(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed with HTTP ${response.status()}.`);
  }
}

try {
  await writeFile(imagePath, onePixelPng, { flag: "wx" });

  const context = await browser.newContext();
  const health = await context.request.get(new URL("/api/health", baseUrl).toString());
  requireSuccessfulResponse(health, "Liveness check");

  const readiness = await context.request.get(new URL("/api/health/ready", baseUrl).toString());
  requireSuccessfulResponse(readiness, "Readiness check");

  const mongo = await context.request.post(new URL("/api/spikes/mongodb", baseUrl).toString(), {
    headers: authorization,
  });
  requireSuccessfulResponse(mongo, "MongoDB spike");
  const mongoBody = await mongo.json();
  const mongoVerified =
    mongoBody?.data?.connectionReused === true &&
    mongoBody?.data?.readVerified === true &&
    mongoBody?.data?.writeVerified === true;

  if (!mongoVerified) {
    throw new Error("MongoDB spike did not verify every invariant.");
  }

  const page = await context.newPage();
  let blobRequestFailure;
  let browserPolicyFailure;
  const blobResponses = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy|refused to connect/i.test(text)) {
      browserPolicyFailure = "csp";
    } else if (/cors|access-control-allow-origin/i.test(text)) {
      browserPolicyFailure = "cors";
    }
  });
  page.on("requestfailed", (request) => {
    const hostname = new URL(request.url()).hostname;
    if (hostname.endsWith(".blob.vercel-storage.com")) {
      blobRequestFailure = request.failure()?.errorText;
    }
  });
  page.on("response", (response) => {
    const hostname = new URL(response.url()).hostname;
    if (hostname.endsWith(".blob.vercel-storage.com")) {
      blobResponses.push({ method: response.request().method(), status: response.status() });
    }
  });
  await page.goto(new URL("/studio/spikes", baseUrl).toString());
  await page.locator("#spike-token").fill(token);

  const uploadSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: /Vercel Blob direct upload/ }),
  });
  await uploadSection.locator('input[type="file"]').setInputFiles(imagePath);

  const downloadLink = uploadSection.locator('a[target="_blank"]');
  const uploadStatus = uploadSection.locator('p[aria-live="polite"]');
  const statusElement = await uploadStatus.elementHandle();
  if (!statusElement) {
    throw new Error("Blob spike status element is missing.");
  }
  await page.waitForFunction(
    (element) => {
      const text = element.textContent?.trim() ?? "";
      return text !== "" && text !== "Chưa chọn ảnh." && !text.startsWith("Đang");
    },
    statusElement,
    { timeout: 60_000 },
  );

  if (!(await downloadLink.isVisible())) {
    const status = (await uploadStatus.textContent())?.trim();
    throw new Error(
      `Blob browser flow did not complete: ${JSON.stringify({
        blobRequestFailure,
        blobResponses,
        browserPolicyFailure,
        status,
      })}`,
    );
  }

  const downloadUrl = await downloadLink.getAttribute("href");
  if (!downloadUrl) {
    throw new Error("Blob spike did not return a signed download URL.");
  }

  const download = await context.request.get(downloadUrl);
  requireSuccessfulResponse(download, "Signed WebP download");
  const downloadBytes = await download.body();
  const downloadContentType = download.headers()["content-type"] ?? "";

  if (!downloadContentType.startsWith("image/webp") || downloadBytes.length === 0) {
    throw new Error("Signed download did not return a non-empty WebP derivative.");
  }

  process.stdout.write(
    `${JSON.stringify({
      blobBrowserUpload: "pass",
      derivativeBytes: downloadBytes.length,
      derivativeContentType: downloadContentType,
      health: "pass",
      mongo: "pass",
      readiness: "pass",
    })}\n`,
  );
} finally {
  await browser.close();
  await unlink(imagePath).catch(() => undefined);
}
