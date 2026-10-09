import { type Browser, type Page } from "@playwright/test";
import { randomInt, randomUUID } from "node:crypto";
import { UUID } from "mongodb";

import { signInThroughMagicLink, uniqueE2eEmail } from "./support/auth";
import {
  cleanupE2eRecord,
  createMemoryBoxDraft,
  type E2eRecord,
  findGiftId,
  withE2eDatabase,
} from "./support/gift-journey";
import { assignOwnAuthClientAddress, expect, test } from "./test";

// The Playwright server configures no billing provider, so the Standard journeys keep the internal
// grant until the webhook change. These checks seed orders directly: the order endpoint and the
// return and cancel pages (`billing-checkout`) read whatever the database holds, and a page never
// trusts the provider's query parameters.

type SeededOrder = Readonly<{ orderId: string; status: string }>;

async function signedInOwner(page: Page, email: string): Promise<E2eRecord> {
  const publicId = await createMemoryBoxDraft(page);
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(`/studio/${publicId}`)}`);
  await signInThroughMagicLink(page, email);
  await expect(page).toHaveURL(new RegExp(`/studio/${publicId}`));
  return { email, publicId };
}

async function ownerIdOf(email: string): Promise<string> {
  const user = await withE2eDatabase((database) =>
    database
      .collection<{ _id: string | UUID; email: string }>("users")
      .findOne({ email }, { projection: { _id: 1 } }),
  );
  if (!user) throw new Error("The E2E owner does not exist.");
  return user._id instanceof UUID ? user._id.toString() : user._id;
}

async function seedOrder(record: E2eRecord, status: string): Promise<SeededOrder> {
  const [giftId, ownerId] = await Promise.all([
    findGiftId(record.publicId),
    ownerIdOf(record.email ?? ""),
  ]);
  const now = new Date();
  const orderId = randomUUID();
  await withE2eDatabase((database) =>
    database.collection<{ _id: string } & Record<string, unknown>>("orders").insertOne({
      _id: orderId,
      amountVnd: 49_000,
      checkoutUrl: status === "pending" ? "https://pay.example/checkout/e2e" : null,
      createdAt: now,
      currency: "VND",
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      giftId,
      giftPublicId: record.publicId,
      orderCode: randomInt(100_000_000_000, 999_999_999_999),
      ownerId,
      planId: "standard",
      planVersion: 1,
      provider: "fake",
      providerPaymentId: null,
      requestFingerprint: "[]",
      revision: 0,
      rightsConfirmedAt: now,
      status,
      updatedAt: now,
    }),
  );
  return { orderId, status };
}

async function cleanupOrders(publicId: string | undefined): Promise<void> {
  if (!publicId) return;
  await withE2eDatabase((database) =>
    database.collection("orders").deleteMany({ giftPublicId: publicId }),
  );
}

async function strangerPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await assignOwnAuthClientAddress(context);
  return context.newPage();
}

test("the owner follows an order on the return and cancel pages, and nobody else can", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  let record: E2eRecord | undefined;
  let stranger: Page | undefined;

  try {
    record = await signedInOwner(page, uniqueE2eEmail("checkout-owner", testInfo));
    const pending = await seedOrder(record, "pending");
    const cancelled = await seedOrder(record, "cancelled");

    // The order endpoint answers the owner only, never cached.
    const read = await page.evaluate(async (orderId) => {
      const response = await fetch(`/api/orders/${orderId}`);
      return {
        body: (await response.json()) as { data?: { order: Record<string, unknown> } },
        cacheControl: response.headers.get("cache-control"),
        status: response.status,
      };
    }, pending.orderId);
    expect(read.status).toBe(200);
    expect(read.cacheControl).toBe("no-store");
    expect(read.body.data?.order).toMatchObject({
      amountVnd: 49_000,
      checkoutUrl: "https://pay.example/checkout/e2e",
      giftPublicId: record.publicId,
      orderId: pending.orderId,
      status: "pending",
    });
    expect(Object.keys(read.body.data?.order ?? {})).not.toContain("orderCode");

    // Forged provider parameters change nothing: the page shows the server's state.
    await page.goto(`/checkout/return?order=${pending.orderId}&status=PAID&code=00`);
    await expect(page.getByRole("heading", { name: "Đang chờ xác nhận thanh toán" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tiếp tục thanh toán" })).toHaveAttribute(
      "href",
      "https://pay.example/checkout/e2e",
    );
    await expect(page.getByRole("link", { name: "Về trang món quà" })).toHaveAttribute(
      "href",
      `/studio/${record.publicId}`,
    );

    await page.goto(`/checkout/cancel?order=${cancelled.orderId}`);
    await expect(page.getByRole("heading", { name: "Thanh toán đã huỷ" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tiếp tục thanh toán" })).toHaveCount(0);

    await page.goto(`/checkout/return?order=${randomUUID()}`);
    await expect(
      page.getByRole("heading", { name: "Không tìm thấy đơn thanh toán này." }),
    ).toBeVisible();

    // Another visitor: a sign-in prompt on the page, and an opaque 404 from the API.
    stranger = await strangerPage(browser);
    await stranger.goto(`/checkout/return?order=${pending.orderId}`);
    await expect(
      stranger.getByRole("heading", { name: "Đăng nhập để xem thanh toán" }),
    ).toBeVisible();
    expect((await stranger.request.get(`/api/orders/${pending.orderId}`)).status()).toBe(404);

    // Without the fake provider configured, its checkout page does not exist.
    expect((await page.request.get("/billing/fake-checkout/unknown")).status()).toBe(404);
  } finally {
    await stranger?.context().close();
    await cleanupOrders(record?.publicId);
    if (record) await cleanupE2eRecord(record);
  }
});
