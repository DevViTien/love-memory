import { describe, expect, it, vi } from "vitest";

import { type PaymentOutcome, type VerifiedPayment } from "../application/payments";
import { isValidDataSignature, signData } from "../infrastructure/payos-signature";
import { handlePayosWebhook, PAYOS_WEBHOOK_MAX_BYTES } from "./payos-webhook-route-handler";

const KEY = "checksum-key";
const data = {
  accountNumber: "12345678",
  amount: 49_000,
  code: "00",
  currency: "VND",
  desc: "Thành công",
  description: "LM 123456789012",
  orderCode: 123_456_789_012,
  paymentLinkId: "abc",
  reference: "TF230204212323",
  transactionDateTime: "2026-10-10 10:00:00",
};

function webhook(body: unknown) {
  return new Request("https://love.example/api/billing/webhooks/payos", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function dependencies(key: string | null = KEY) {
  const record = vi.fn<(payment: VerifiedPayment) => Promise<PaymentOutcome>>(() =>
    Promise.resolve("applied"),
  );
  return { checksumKey: () => key, record, verify: isValidDataSignature };
}

describe("payOS webhook", () => {
  it("records a verified successful payment (Verified payment webhook)", async () => {
    const deps = dependencies();
    const response = await handlePayosWebhook(
      webhook({ code: "00", data, desc: "success", signature: signData(data, KEY), success: true }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(deps.record).toHaveBeenCalledWith({
      amountVnd: 49_000,
      currency: "VND",
      orderCode: 123_456_789_012,
      provider: "payos",
      reference: "TF230204212323",
      source: "webhook",
    });
  });

  it("refuses an invalid signature, malformed JSON and an oversized body (Webhook invalid signature)", async () => {
    const deps = dependencies();
    const forged = { data: { ...data, amount: 1 }, signature: signData(data, KEY) };
    expect((await handlePayosWebhook(webhook(forged), deps)).status).toBe(401);
    expect(
      (await handlePayosWebhook(webhook({ data, signature: signData(data, "other") }), deps))
        .status,
    ).toBe(401);
    expect((await handlePayosWebhook(webhook("{not json"), deps)).status).toBe(401);
    expect((await handlePayosWebhook(webhook({ data }), deps)).status).toBe(401);
    expect(
      (await handlePayosWebhook(webhook("x".repeat(PAYOS_WEBHOOK_MAX_BYTES + 1)), deps)).status,
    ).toBe(401);
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("acknowledges a signed notification that is not a successful payment", async () => {
    const deps = dependencies();
    const failed = { ...data, code: "01" };
    const response = await handlePayosWebhook(
      webhook({ data: failed, signature: signData(failed, KEY) }),
      deps,
    );
    expect(response.status).toBe(200);
    const test = { orderCode: 123 };
    expect(
      (await handlePayosWebhook(webhook({ data: test, signature: signData(test, KEY) }), deps))
        .status,
    ).toBe(200);
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("is not found unless payOS is the configured provider", async () => {
    const deps = dependencies(null);
    const response = await handlePayosWebhook(
      webhook({ data, signature: signData(data, KEY) }),
      deps,
    );
    expect(response.status).toBe(404);
  });

  it("answers 500 when recording fails, so payOS delivers again", async () => {
    const deps = dependencies();
    deps.record.mockRejectedValueOnce(new Error("database down"));
    const response = await handlePayosWebhook(
      webhook({ data, signature: signData(data, KEY) }),
      deps,
    );
    expect(response.status).toBe(500);
  });
});
