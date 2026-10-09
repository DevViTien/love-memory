import { z } from "zod";

import {
  type BillingProvider,
  BillingProviderError,
  type ProviderPaymentStatus,
} from "../application/billing-provider";
import { isValidDataSignature, signPaymentRequest } from "./payos-signature";

export const PAYOS_BASE_URL = "https://api-merchant.payos.vn";
export const PAYOS_TIMEOUT_MILLISECONDS = 10_000;

type Credentials = Readonly<{ apiKey: string; checksumKey: string; clientId: string }>;

const PaymentStatusSchema = z.enum([
  "CANCELLED",
  "EXPIRED",
  "FAILED",
  "PAID",
  "PENDING",
  "PROCESSING",
  "UNDERPAID",
]) satisfies z.ZodType<ProviderPaymentStatus>;

const EnvelopeSchema = z.object({
  code: z.string(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  signature: z.string().optional(),
});

const CreatedLinkSchema = z.object({
  checkoutUrl: z.url(),
  paymentLinkId: z.string().min(1),
});

const PaymentLinkSchema = z.object({
  amount: z.number().int().nonnegative(),
  amountPaid: z.number().int().nonnegative(),
  status: PaymentStatusSchema,
});

/**
 * The first-party payOS adapter (`billing-checkout` "payOS adapter"): `fetch` only, no SDK. Every
 * answer is accepted only with code `00` and a valid signature over its `data`. Errors carry a
 * short reason, never a credential, a payload or a URL.
 */
export function createPayosProvider(
  credentials: Credentials,
  fetchImpl: typeof fetch = fetch,
): BillingProvider {
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, PAYOS_BASE_URL), {
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": credentials.apiKey,
          "x-client-id": credentials.clientId,
        },
        method,
        signal: AbortSignal.timeout(PAYOS_TIMEOUT_MILLISECONDS),
      });
    } catch {
      throw new BillingProviderError("unreachable");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BillingProviderError(`invalid-body-${response.status}`);
    }
    const envelope = EnvelopeSchema.safeParse(payload);
    if (!envelope.success) throw new BillingProviderError(`invalid-body-${response.status}`);
    const { code, data, signature } = envelope.data;
    if (code !== "00" || !data) throw new BillingProviderError(`code-${code}`);
    if (!signature || !isValidDataSignature(data, signature, credentials.checksumKey)) {
      throw new BillingProviderError("invalid-signature");
    }
    return data;
  }

  return {
    async cancelPaymentLink(orderCode, reason) {
      await call("POST", `/v2/payment-requests/${orderCode}/cancel`, {
        cancellationReason: reason,
      });
    },

    async createPaymentLink(input) {
      const request = {
        amount: input.amountVnd,
        cancelUrl: input.cancelUrl,
        description: input.description,
        orderCode: input.orderCode,
        returnUrl: input.returnUrl,
      };
      const data = await call("POST", "/v2/payment-requests", {
        ...request,
        expiredAt: Math.floor(input.expiresAt.getTime() / 1000),
        items: [{ name: input.itemName, price: input.amountVnd, quantity: 1 }],
        signature: signPaymentRequest(request, credentials.checksumKey),
      });
      const created = CreatedLinkSchema.safeParse(data);
      if (!created.success) throw new BillingProviderError("invalid-payment-link");
      return {
        checkoutUrl: created.data.checkoutUrl,
        providerPaymentId: created.data.paymentLinkId,
      };
    },

    async getPayment(orderCode) {
      const data = await call("GET", `/v2/payment-requests/${orderCode}`);
      const link = PaymentLinkSchema.safeParse(data);
      if (!link.success) throw new BillingProviderError("invalid-payment-information");
      return {
        amountPaidVnd: link.data.amountPaid,
        amountVnd: link.data.amount,
        status: link.data.status,
      };
    },

    id: "payos",
  };
}
