import { GiftDraftResponseSchema, HealthResponseSchema } from "@love-memory/contracts";
import { expect, test } from "@playwright/test";
import { type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const authCapturePath = resolve(".tmp/e2e-auth-emails.jsonl");
const cleanupRecords: Array<{ email?: string; publicId: string }> = [];

async function cleanupE2eRecord(record: Readonly<{ email?: string; publicId: string }>) {
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
      .findOne({ publicId: record.publicId }, { projection: { _id: 1 } });
    const user = record.email
      ? await database
          .collection<{ _id: string }>("users")
          .findOne({ email: record.email }, { projection: { _id: 1 } })
      : null;

    await Promise.all([
      gift
        ? database.collection("giftRevisions").deleteMany({ giftId: gift._id })
        : Promise.resolve(),
      gift
        ? database.collection("idempotencyKeys").deleteMany({ giftId: gift._id })
        : Promise.resolve(),
      user ? database.collection("accounts").deleteMany({ userId: user._id }) : Promise.resolve(),
      user ? database.collection("sessions").deleteMany({ userId: user._id }) : Promise.resolve(),
      record.email
        ? database.collection("verifications").deleteMany({ identifier: record.email })
        : Promise.resolve(),
    ]);
    await database.collection("gifts").deleteOne({ publicId: record.publicId });
    if (user) {
      await database.collection<{ _id: string }>("users").deleteOne({ _id: user._id });
    }
  } finally {
    await client.close();
  }
}

async function idempotencyGiftOwnerKind(key: string): Promise<"anonymous" | "missing" | "user"> {
  const uri = process.env["MONGODB_URI"];
  const databaseName = process.env["MONGODB_DATABASE"];
  if (!uri || !databaseName) {
    throw new Error("E2E idempotency verification requires MONGODB_URI and MONGODB_DATABASE.");
  }

  const client = await new MongoClient(uri).connect();
  try {
    const database = client.db(databaseName);
    const record = await database
      .collection<{ giftId: string }>("idempotencyKeys")
      .findOne({ key, scope: "gift-create" }, { projection: { giftId: 1 } });
    if (!record) {
      return "missing";
    }
    const gift = await database
      .collection<{ _id: string; ownership: { ownerId: string | null } }>("gifts")
      .findOne({ _id: record.giftId }, { projection: { "ownership.ownerId": 1 } });
    return gift?.ownership.ownerId ? "user" : gift ? "anonymous" : "missing";
  } finally {
    await client.close();
  }
}

test.afterEach(async () => {
  const records = cleanupRecords.splice(0);
  await Promise.all(records.map(cleanupE2eRecord));
});

async function capturedMagicLink(email: string): Promise<string | null> {
  const content = await readFile(authCapturePath, "utf8").catch(() => "");
  const messages = content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Readonly<{ email: string; url: string }>];
      } catch {
        return [];
      }
    });
  return messages.findLast((message) => message.email === email)?.url ?? null;
}

function responseData(payload: unknown): unknown {
  return typeof payload === "object" && payload !== null && "data" in payload ? payload.data : null;
}

async function failNextAuthRequest(page: Page, pathname: string): Promise<void> {
  await page.route(
    `**${pathname}`,
    (route) =>
      route.fulfill({
        body: JSON.stringify({ code: "TEST_PROVIDER_UNAVAILABLE", message: "Unavailable" }),
        contentType: "application/json",
        status: 503,
      }),
    { times: 1 },
  );
}

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      const source = message.location().url;
      errors.push(`console: ${message.text()}${source ? ` (${source})` : ""}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  return errors;
}

test("shows the product promise and template catalog", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  const response = await page.goto("/");

  expect(response?.headers()["content-security-policy"]).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  expect(response?.headers()["content-security-policy"]).not.toContain("strict-dynamic");

  await expect(
    page.getByRole("heading", {
      name: "Biến ký ức của hai người thành một món quà biết kể chuyện.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Khám phá template" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hộp ký ức" })).toBeVisible();
  await page.getByRole("link", { name: "Khám phá template" }).click();
  await expect(page).toHaveURL(/\/templates$/);
  expect(browserErrors).toEqual([]);
});

test("applies nonce CSP to the dynamically rendered Studio", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  const response = await page.goto("/studio/new?template=memory-box");
  const policy = response?.headers()["content-security-policy"];

  expect(policy).toContain("strict-dynamic");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  await expect(page.getByRole("heading", { name: "Bắt đầu với Hộp ký ức" })).toBeVisible();

  const scriptsHaveNonces = await page
    .locator("script")
    .evaluateAll(
      (scripts) => scripts.length > 0 && scripts.every((script) => script.nonce.length > 0),
    );
  expect(scriptsHaveNonces).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("exposes a validated liveness endpoint", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = HealthResponseSchema.parse(await response.json());

  expect(response.ok()).toBe(true);
  expect(response.headers()["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(body.data).toMatchObject({
    service: "love-memory",
    status: "ok",
    version: "0.1.0",
  });
});

test("requests a passwordless sign-in link without exposing account existence", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/magic-link", async (route) => {
    await route.fulfill({ body: JSON.stringify({ data: { status: true } }), status: 200 });
  });

  await page.goto("/auth/sign-in");
  await page.getByLabel("Email của bạn").fill("creator@example.com");
  await page.getByRole("button", { name: "Gửi liên kết đăng nhập" }).click();

  await expect(page.getByText("Kiểm tra hộp thư của bạn")).toBeVisible();
  await expect(page.getByText(/Nếu địa chỉ hợp lệ/)).toBeVisible();
});

test("recovers the passwordless form after a provider failure", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await failNextAuthRequest(page, "/api/auth/sign-in/magic-link");
  await page.getByLabel("Email của bạn").fill("creator@example.com");
  await page.getByRole("button", { name: "Gửi liên kết đăng nhập" }).click();

  await expect(page.getByText("Chưa thể gửi email lúc này", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gửi liên kết đăng nhập" })).toBeEnabled();
});

test("creates, edits and claims a draft through a real passwordless session", async ({ page }) => {
  await page.goto("/");
  const idempotencyKey = randomUUID();
  const createResult = await page.evaluate(async (key) => {
    const create = () =>
      fetch("/api/gifts", {
        body: JSON.stringify({ templateId: "midnight-wish", templateVersion: "1.0.0" }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        method: "POST",
      }).then(async (response) => {
        const body: unknown = await response.json();
        return { body, status: response.status };
      });
    return { first: await create(), replay: await create() };
  }, idempotencyKey);

  expect(createResult.first.status).toBe(201);
  expect(createResult.replay.status).toBe(201);
  const firstGift = GiftDraftResponseSchema.parse(responseData(createResult.first.body)).gift;
  const replayedGift = GiftDraftResponseSchema.parse(responseData(createResult.replay.body)).gift;
  const publicId = firstGift.publicId;
  const cleanupRecord: { email?: string; publicId: string } = { publicId };
  cleanupRecords.push(cleanupRecord);
  expect(replayedGift.publicId).toBe(publicId);
  const mismatchedReplayStatus = await page.evaluate(async (key) => {
    const response = await fetch("/api/gifts", {
      body: JSON.stringify({ templateId: "memory-box", templateVersion: "1.0.0" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      method: "POST",
    });
    return response.status;
  }, idempotencyKey);
  expect(mismatchedReplayStatus).toBe(409);

  await page.goto(`/studio/${publicId}`);
  await page.locator('input[type="text"]').fill("Người thương");
  await page.locator("textarea").fill("Mỗi vì sao là một kỷ niệm của chúng mình.");
  await page.locator("main button").first().click();
  await expect(page.getByText("Revision 1", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Đăng nhập để lưu lâu dài" }).click();
  const email = `creator-${randomUUID()}@example.com`;
  cleanupRecord.email = email;
  await page.getByLabel("Email của bạn").fill(email);
  await page.getByRole("button", { name: "Gửi liên kết đăng nhập" }).click();
  await expect(page.getByText("Kiểm tra hộp thư của bạn")).toBeVisible();

  await expect.poll(() => capturedMagicLink(email)).not.toBeNull();
  const magicLink = await capturedMagicLink(email);
  if (!magicLink) {
    throw new Error("Passwordless email capture did not contain a magic link.");
  }
  await page.goto(magicLink);
  await expect(page).toHaveURL(new RegExp(`/studio/${publicId}$`));
  await page.getByRole("button", { name: "Lưu bản nháp vào tài khoản" }).click();
  await expect(page.getByRole("button", { name: "Lưu bản nháp vào tài khoản" })).toHaveCount(0);

  await page.locator("textarea").fill("Bản nháp vẫn lưu được sau khi liên kết tài khoản.");
  await page.locator("main button").first().click();
  await expect(page.getByText("Revision 2", { exact: true })).toBeVisible();
  await expect.poll(() => idempotencyGiftOwnerKind(idempotencyKey)).toBe("user");

  await page.goto("/auth/sign-in");
  await expect(page.getByText(email, { exact: false })).toBeVisible();
  await failNextAuthRequest(page, "/api/auth/sign-out");
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page.getByText("Chưa thể đăng xuất lúc này", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeEnabled();

  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page.getByLabel("Email của bạn")).toBeVisible();
  await expect.poll(() => idempotencyGiftOwnerKind(idempotencyKey)).toBe("user");

  const revokedReplayStatus = await page.evaluate(async (key) => {
    const response = await fetch("/api/gifts", {
      body: JSON.stringify({ templateId: "midnight-wish", templateVersion: "1.0.0" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      method: "POST",
    });
    return response.status;
  }, idempotencyKey);
  expect(revokedReplayStatus).toBe(409);
});

test("explains an invalid or expired magic link", async ({ page }) => {
  await page.goto("/auth/sign-in?error=invalid-link");
  await expect(page.getByText("Liên kết đăng nhập không hợp lệ", { exact: false })).toBeVisible();
});

test("isolates, controls, destroys and reloads the template spike", async ({ page, request }) => {
  const browserErrors = captureBrowserErrors(page);
  const response = await page.goto("/studio/spikes");

  expect(response?.headers()["content-security-policy"]).toContain("strict-dynamic");
  const frame = page.getByTitle("Memory Box sandbox spike");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(page.getByText("Event: READY")).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByText("Event: COMPLETE")).toBeVisible();
  await page.getByRole("button", { name: "Destroy", exact: true }).click();
  await expect(page.getByText("Event: DESTROY sent")).toBeVisible();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByText("Event: READY")).toBeVisible();

  const artifactResponse = await request.get("/template-spikes/memory-box");
  expect(artifactResponse.headers()["content-security-policy"]).toContain("connect-src 'none'");
  expect(artifactResponse.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(browserErrors).toEqual([]);
});

test("requires authorization for enabled mutation spike endpoints", async ({ request }) => {
  const response = await request.post("/api/spikes/mongodb");

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
});
