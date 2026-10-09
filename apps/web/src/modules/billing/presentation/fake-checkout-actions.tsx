"use client";

import { Button } from "@love-memory/ui";
import { useState } from "react";

export const FAKE_CHECKOUT_FAILED = "Không huỷ được phiên thanh toán thử. Hãy tải lại trang.";

/**
 * The fake provider's own buttons (`billing-checkout` "Fake billing provider"): development and
 * E2E only. Cancelling marks the link `CANCELLED`, then opens the order's cancel page.
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

  async function cancel() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await (fetchImpl ?? fetch)(
        `/api/billing/fake/${encodeURIComponent(paymentId)}`,
        {
          body: JSON.stringify({ action: "cancel" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (response.ok) {
        navigate(cancelUrl);
        return;
      }
    } catch {
      // Shown below.
    }
    setFailed(true);
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <Button disabled={busy} onClick={() => void cancel()} variant="outline">
        Huỷ thanh toán
      </Button>
      {failed ? (
        <p className="text-sm font-semibold text-rose-700" role="alert">
          {FAKE_CHECKOUT_FAILED}
        </p>
      ) : null}
    </div>
  );
}
