import { describe, expect, it, vi } from "vitest";

import { BillingProviderError } from "../application/billing-provider";
import { createPayosProvider } from "./payos-provider";
import { signData, signPaymentRequest } from "./payos-signature";

const credentials = { apiKey: "api-key", checksumKey: "checksum-key", clientId: "client-id" };

function signed(data: Record<string, unknown>, code = "00") {
  return { code, data, desc: "success", signature: signData(data, credentials.checksumKey) };
}

function fetchAnswering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

const link = {
  amount: 49_000,
  checkoutUrl: "https://pay.payos.vn/web/abc",
  description: "LM 123456789012",
  orderCode: 123_456_789_012,
  paymentLinkId: "abc",
  status: "PENDING",
};

const input = {
  amountVnd: 49_000,
  cancelUrl: "https://lovememory.example/checkout/cancel?order=o-1",
  description: "LM 123456789012",
  expiresAt: new Date("2026-10-10T10:15:00.000Z"),
  itemName: "LoveMemory - Tiêu chuẩn",
  orderCode: 123_456_789_012,
  returnUrl: "https://lovememory.example/checkout/return?order=o-1",
};

describe("payOS adapter", () => {
  it("creates a signed payment link and accepts a signed answer", async () => {
    const fetchImpl = fetchAnswering(signed(link));
    const provider = createPayosProvider(credentials, fetchImpl);

    await expect(provider.createPaymentLink(input)).resolves.toEqual({
      checkoutUrl: "https://pay.payos.vn/web/abc",
      providerPaymentId: "abc",
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect((url as URL).toString()).toBe("https://api-merchant.payos.vn/v2/payment-requests");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-api-key": "api-key", "x-client-id": "client-id" });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      amount: 49_000,
      expiredAt: 1_791_627_300,
      items: [{ name: "LoveMemory - Tiêu chuẩn", price: 49_000, quantity: 1 }],
      orderCode: 123_456_789_012,
      signature: signPaymentRequest(
        {
          amount: 49_000,
          cancelUrl: input.cancelUrl,
          description: input.description,
          orderCode: input.orderCode,
          returnUrl: input.returnUrl,
        },
        credentials.checksumKey,
      ),
    });
  });

  it("rejects a tampered, unsigned, refused or unreadable answer (Tampered response)", async () => {
    const tampered = { ...signed(link), data: { ...link, checkoutUrl: "https://evil.example" } };
    const answers: unknown[] = [
      tampered,
      { code: "00", data: link },
      signed(link, "231"),
      { code: "00", data: null },
      "not an envelope",
    ];
    for (const answer of answers) {
      const provider = createPayosProvider(credentials, fetchAnswering(answer));
      await expect(provider.createPaymentLink(input)).rejects.toBeInstanceOf(BillingProviderError);
    }

    const broken = createPayosProvider(
      credentials,
      vi.fn<typeof fetch>(() => Promise.resolve(new Response("<html>", { status: 502 }))),
    );
    await expect(broken.createPaymentLink(input)).rejects.toThrow("invalid-body-502");

    const offline = createPayosProvider(
      credentials,
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed"))),
    );
    await expect(offline.getPayment(1)).rejects.toThrow("unreachable");
  });

  it("refuses a signed answer that is not a payment link", async () => {
    const provider = createPayosProvider(credentials, fetchAnswering(signed({ orderCode: 1 })));
    await expect(provider.createPaymentLink(input)).rejects.toThrow("invalid-payment-link");
    await expect(provider.getPayment(1)).rejects.toThrow("invalid-payment-information");
  });

  it("reads a payment link's status, and cancels it", async () => {
    const fetchImpl = fetchAnswering(
      signed({ amount: 49_000, amountPaid: 0, id: "abc", status: "CANCELLED" }),
    );
    const provider = createPayosProvider(credentials, fetchImpl);

    await expect(provider.getPayment(123_456_789_012)).resolves.toEqual({
      amountPaidVnd: 0,
      amountVnd: 49_000,
      status: "CANCELLED",
    });
    await provider.cancelPaymentLink(123_456_789_012, "Superseded");

    expect((fetchImpl.mock.calls[0]?.[0] as URL).toString()).toBe(
      "https://api-merchant.payos.vn/v2/payment-requests/123456789012",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
    expect((fetchImpl.mock.calls[1]?.[0] as URL).toString()).toBe(
      "https://api-merchant.payos.vn/v2/payment-requests/123456789012/cancel",
    );
    expect(JSON.parse(fetchImpl.mock.calls[1]?.[1]?.body as string)).toEqual({
      cancellationReason: "Superseded",
    });
    expect(provider.id).toBe("payos");
  });
});
