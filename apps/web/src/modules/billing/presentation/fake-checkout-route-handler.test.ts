import { describe, expect, it, vi } from "vitest";

import { handleFakeCheckoutAction } from "./fake-checkout-route-handler";

function action(body = JSON.stringify({ action: "cancel" })) {
  return new Request("https://love.example/api/billing/fake/p1", {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

const params = { params: Promise.resolve({ paymentId: "p1" }) };

describe("fake checkout action", () => {
  it("cancels a pending fake link (Cancel at the fake provider)", async () => {
    const cancel = vi.fn(() => true);
    const response = await handleFakeCheckoutAction(action(), params, {
      cancel,
      isFakeProvider: () => true,
      pay: () => Promise.resolve(null),
    });
    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("p1");
  });

  it("is not found unless the fake provider is configured, or for an unknown link", async () => {
    const cancel = vi.fn(() => false);
    expect(
      (
        await handleFakeCheckoutAction(action(), params, {
          cancel,
          isFakeProvider: () => false,
          pay: () => Promise.resolve(null),
        })
      ).status,
    ).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
    expect(
      (
        await handleFakeCheckoutAction(action(), params, {
          cancel,
          isFakeProvider: () => true,
          pay: () => Promise.resolve(null),
        })
      ).status,
    ).toBe(404);
  });

  it("pays a pending fake link and answers its return page", async () => {
    const pay = vi.fn(() => Promise.resolve("http://127.0.0.1:3100/checkout/return?order=o-1"));
    const response = await handleFakeCheckoutAction(
      action(JSON.stringify({ action: "pay" })),
      params,
      {
        cancel: () => false,
        isFakeProvider: () => true,
        pay,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { returnUrl: "http://127.0.0.1:3100/checkout/return?order=o-1", status: "PAID" },
    });
    expect(pay).toHaveBeenCalledWith("p1");

    const unknown = await handleFakeCheckoutAction(
      action(JSON.stringify({ action: "pay" })),
      params,
      {
        cancel: () => false,
        isFakeProvider: () => true,
        pay: () => Promise.resolve(null),
      },
    );
    expect(unknown.status).toBe(404);
  });

  it("accepts only the cancel and pay actions", async () => {
    const response = await handleFakeCheckoutAction(
      action(JSON.stringify({ action: "refund" })),
      params,
      { cancel: () => true, isFakeProvider: () => true, pay: () => Promise.resolve(null) },
    );
    expect(response.status).toBe(400);
  });
});
