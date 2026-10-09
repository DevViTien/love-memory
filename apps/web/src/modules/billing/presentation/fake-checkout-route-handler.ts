import { API_ERROR_CODES } from "@love-memory/contracts";
import { z } from "zod";

import { getBillingEnvironment } from "@/config/billing";
import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  requestId,
  validateJsonMutationRequest,
} from "@/http/api-response";

const FakeCheckoutActionSchema = z.object({ action: z.enum(["cancel", "pay"]) }).strict();

type Dependencies = Readonly<{
  /** `PENDING` → `CANCELLED`; `false` for an unknown or closed link. */
  cancel: (paymentId: string) => boolean;
  isFakeProvider?: () => boolean;
  /** `PENDING` → `PAID`, recorded as a verified payment; the return URL, or `null`. */
  pay: (paymentId: string) => Promise<string | null>;
}>;

/**
 * `POST /api/billing/fake/{paymentId}`: the fake provider's own cancel and pay actions. Not found
 * unless the fake provider is configured, which no Vercel deployment allows.
 */
export async function handleFakeCheckoutAction(
  request: Request,
  routeContext: Readonly<{ params: Promise<{ paymentId: string }> }>,
  { cancel, isFakeProvider = () => getBillingEnvironment().kind === "fake", pay }: Dependencies,
): Promise<Response> {
  const id = requestId(request);
  const notFound = () =>
    createApiErrorResponse({
      code: API_ERROR_CODES.notFound,
      message: "Payment link was not found.",
      requestId: id,
      status: 404,
    });
  if (!isFakeProvider()) return notFound();

  const rejectedMutation = validateJsonMutationRequest(request, id);
  if (rejectedMutation) return rejectedMutation;
  const body = await readJsonBody(request, FakeCheckoutActionSchema, { maxBytes: 256 });
  if (!body.ok) return createInvalidBodyResponse(body.error, id);

  const paymentId = (await routeContext.params).paymentId;
  if (body.data.action === "pay") {
    const returnUrl = await pay(paymentId);
    return returnUrl ? createApiSuccessResponse({ returnUrl, status: "PAID" }, id) : notFound();
  }
  return cancel(paymentId) ? createApiSuccessResponse({ status: "CANCELLED" }, id) : notFound();
}
