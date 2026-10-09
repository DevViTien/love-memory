import { describe, expect, it } from "vitest";

import { BillingProviderError } from "../application/billing-provider";
import {
  cancelFakePaymentLink,
  createFakeProvider,
  type FakePaymentLink,
  fakePaymentLinks,
} from "./fake-provider";

const input = {
  amountVnd: 49_000,
  cancelUrl: "http://127.0.0.1:3100/checkout/cancel?order=o-1",
  description: "LM 123456789012",
  expiresAt: new Date("2026-10-10T10:15:00.000Z"),
  itemName: "LoveMemory - Tiêu chuẩn",
  orderCode: 123_456_789_012,
  returnUrl: "http://127.0.0.1:3100/checkout/return?order=o-1",
};

describe("fake billing provider", () => {
  it("creates a pending link served by its own checkout page", async () => {
    const store = new Map<string, FakePaymentLink>();
    const provider = createFakeProvider(
      () => new URL("http://127.0.0.1:3100"),
      store,
      () => "p1",
    );

    await expect(provider.createPaymentLink(input)).resolves.toEqual({
      checkoutUrl: "http://127.0.0.1:3100/billing/fake-checkout/p1",
      providerPaymentId: "p1",
    });
    expect(store.get("p1")).toMatchObject({ orderCode: input.orderCode, status: "PENDING" });
    await expect(provider.getPayment(input.orderCode)).resolves.toEqual({
      amountPaidVnd: 0,
      amountVnd: 49_000,
      status: "PENDING",
    });
    expect(provider.id).toBe("fake");
  });

  it("cancels once, by payment id or by order code (Cancel at the fake provider)", async () => {
    const store = new Map<string, FakePaymentLink>();
    const provider = createFakeProvider(
      () => new URL("http://127.0.0.1:3100"),
      store,
      () => "p2",
    );
    await provider.createPaymentLink(input);

    expect(cancelFakePaymentLink("p2", store)).toBe(true);
    expect(cancelFakePaymentLink("p2", store)).toBe(false);
    expect(cancelFakePaymentLink("unknown", store)).toBe(false);
    await expect(provider.getPayment(input.orderCode)).resolves.toMatchObject({
      status: "CANCELLED",
    });

    const other = createFakeProvider(
      () => new URL("http://127.0.0.1:3100"),
      store,
      () => "p3",
    );
    await other.createPaymentLink({ ...input, orderCode: 222_222_222_222 });
    await other.cancelPaymentLink(222_222_222_222, "Superseded");
    await other.cancelPaymentLink(333_333_333_333, "Unknown");
    expect(store.get("p3")?.status).toBe("CANCELLED");
  });

  it("reports an unknown link as a provider failure, and shares one store per process", async () => {
    const provider = createFakeProvider(() => new URL("http://127.0.0.1:3100"), new Map());
    await expect(provider.getPayment(1)).rejects.toBeInstanceOf(BillingProviderError);
    expect(fakePaymentLinks()).toBe(fakePaymentLinks());
  });
});
