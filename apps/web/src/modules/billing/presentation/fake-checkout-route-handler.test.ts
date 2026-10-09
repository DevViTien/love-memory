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
    });
    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("p1");
  });

  it("is not found unless the fake provider is configured, or for an unknown link", async () => {
    const cancel = vi.fn(() => false);
    expect(
      (await handleFakeCheckoutAction(action(), params, { cancel, isFakeProvider: () => false }))
        .status,
    ).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
    expect(
      (await handleFakeCheckoutAction(action(), params, { cancel, isFakeProvider: () => true }))
        .status,
    ).toBe(404);
  });

  it("accepts only the cancel action", async () => {
    const response = await handleFakeCheckoutAction(
      action(JSON.stringify({ action: "pay" })),
      params,
      { cancel: () => true, isFakeProvider: () => true },
    );
    expect(response.status).toBe(400);
  });
});
