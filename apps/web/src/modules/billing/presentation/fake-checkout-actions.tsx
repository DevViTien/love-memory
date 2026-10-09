"use client";

import { Button } from "@love-memory/ui";
import { useState } from "react";
import { z } from "zod";

export const FAKE_CHECKOUT_FAILED =
  "Không thực hiện được trên cổng thanh toán thử. Hãy tải lại trang.";

const PaidResponseSchema = z.object({ data: z.object({ returnUrl: z.string().min(1) }) });

/**
 * The fake provider's own buttons (`billing-checkout` "Fake billing provider"): development and
 * E2E only. Paying records a verified payment, then opens the order's return page; cancelling
 * marks the link `CANCELLED`, then opens its cancel page.
 */
export function FakeCheckoutActions({
  cancelUrl,
  fetchImpl,
  navigate = (url) => window.location.assign(url),
  paymentId,
}: Readonly<{
  cancelUrl: string;
  fetchImpl?: typeof fetch;
  navigate?: (url: string) => void;
  paymentId: string;
}>) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(action: "cancel" | "pay") {
    setBusy(true);
    setFailed(false);
    try {
      const response = await (fetchImpl ?? fetch)(
        `/api/billing/fake/${encodeURIComponent(paymentId)}`,
        {
          body: JSON.stringify({ action }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (response.ok) {
        if (action === "cancel") {
          navigate(cancelUrl);
          return;
        }
        const paid = PaidResponseSchema.safeParse(await response.json());
        if (paid.success) {
          navigate(paid.data.data.returnUrl);
          return;
        }
      }
    } catch {
      // Shown below.
    }
    setFailed(true);
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => void act("pay")}>
          Thanh toán thử
        </Button>
        <Button disabled={busy} onClick={() => void act("cancel")} variant="outline">
          Huỷ thanh toán
        </Button>
      </div>
      {failed ? (
        <p className="text-sm font-semibold text-rose-700" role="alert">
          {FAKE_CHECKOUT_FAILED}
        </p>
      ) : null}
    </div>
  );
}
