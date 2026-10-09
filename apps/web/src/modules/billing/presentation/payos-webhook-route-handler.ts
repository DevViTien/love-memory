import { API_ERROR_CODES } from "@love-memory/contracts";
import { z } from "zod";

import { createApiErrorResponse, requestId } from "@/http/api-response";
import { reportOperationalFailure } from "@/observability/operational-errors";

import { type PaymentOutcome, type VerifiedPayment } from "../application/payments";

/** A payOS notification is a few hundred bytes; anything above 16 KiB is refused unread. */
export const PAYOS_WEBHOOK_MAX_BYTES = 16 * 1024;

const WebhookSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  signature: z.string(),
});

const PaymentDataSchema = z.object({
  amount: z.number().int().nonnegative(),
  code: z.string(),
  currency: z.string().min(1).optional(),
  orderCode: z.number().int().positive(),
  reference: z.string().min(1),
});

type Dependencies = Readonly<{
  /** The checksum key while payOS is the configured provider, otherwise `null`. */
  checksumKey: () => string | null;
  record: (payment: VerifiedPayment) => Promise<PaymentOutcome>;
  verify: (data: Readonly<Record<string, unknown>>, signature: string, key: string) => boolean;
}>;

function acknowledged(id: string): Response {
  // payOS expects a 2xx: anything else is retried. Nothing about the payment is echoed.
  return Response.json(
    { success: true },
    { headers: { "Cache-Control": "no-store", "x-request-id": id }, status: 200 },
  );
}

/**
 * `POST /api/billing/webhooks/payos` (`billing-checkout` "Verified payment webhook"). The raw body
 * is read once, never logged, and accepted only with a valid signature over its `data`. A signed
 * notification of an unknown order (such as payOS's own test when the URL is registered) is
 * acknowledged and recorded as `unknown_order`.
 */
export async function handlePayosWebhook(
  request: Request,
  { checksumKey, record, verify }: Dependencies,
): Promise<Response> {
  const id = requestId(request);
  const key = checksumKey();
  if (!key) {
    return createApiErrorResponse({
      code: API_ERROR_CODES.notFound,
      message: "Not found.",
      requestId: id,
      status: 404,
    });
  }
  const invalid = () =>
    createApiErrorResponse({
      code: API_ERROR_CODES.unauthorized,
      message: "The notification could not be verified.",
      requestId: id,
      status: 401,
    });

  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > PAYOS_WEBHOOK_MAX_BYTES) return invalid();
    const raw = await request.text();
    if (raw.length > PAYOS_WEBHOOK_MAX_BYTES) return invalid();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return invalid();
    }
    const webhook = WebhookSchema.safeParse(parsed);
    if (!webhook.success || !verify(webhook.data.data, webhook.data.signature, key)) {
      return invalid();
    }

    const payment = PaymentDataSchema.safeParse(webhook.data.data);
    // Signed but not a successful payment: nothing to apply.
    if (!payment.success || payment.data.code !== "00") return acknowledged(id);

    await record({
      amountVnd: payment.data.amount,
      currency: payment.data.currency ?? "VND",
      orderCode: payment.data.orderCode,
      provider: "payos",
      reference: payment.data.reference,
      source: "webhook",
    });
    return acknowledged(id);
  } catch (error) {
    // A 500 makes payOS deliver again; the payment record makes the retry harmless.
    reportOperationalFailure("billing_webhook", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The notification could not be processed.",
      requestId: id,
      status: 500,
    });
  }
}
