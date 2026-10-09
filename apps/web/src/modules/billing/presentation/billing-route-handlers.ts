import {
  API_ERROR_CODES,
  GiftIdempotencyKeySchema,
  OrderIdSchema,
  PublicGiftIdSchema,
  StartCheckoutRequestSchema,
} from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  validateJsonMutationRequest,
} from "@/http/api-response";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
  type GiftRequestContext,
  giftServiceErrorResponse,
  requestId,
} from "@/modules/gifts/presentation/gift-route-helpers";
import { reportOperationalFailure } from "@/observability/operational-errors";

import { type CheckoutService, type CheckoutServiceError } from "../application/checkout-service";

/** The publish body: a few bytes; above 1 KiB is refused unread. */
export const CHECKOUT_BODY_MAX_BYTES = 1024;

export type BillingRouteDependencies = Readonly<{
  getContext?: (request: Request) => Promise<GiftRequestContext>;
  limit?: typeof enforceGiftMutationRateLimit;
  service: () => Pick<CheckoutService, "getOrder" | "startCheckout">;
}>;

function checkoutErrorResponse(error: CheckoutServiceError, id: string): Response {
  if (error.code === "PAYMENT_PROVIDER_UNAVAILABLE") {
    return createApiErrorResponse({
      code: API_ERROR_CODES.unavailable,
      details: { reason: "PAYMENT_PROVIDER_UNAVAILABLE" },
      message: "The payment provider is not available.",
      requestId: id,
      status: 503,
    });
  }
  return giftServiceErrorResponse(error, id);
}

function orderNotFound(id: string): Response {
  return createApiErrorResponse({
    code: API_ERROR_CODES.notFound,
    message: "Order was not found.",
    requestId: id,
    status: 404,
  });
}

function internalError(operation: string, error: unknown, id: string, message: string) {
  // Never the order, the gift, a provider payload or the error message.
  reportOperationalFailure(operation, error, id);
  return createApiErrorResponse({
    code: API_ERROR_CODES.internal,
    message,
    requestId: id,
    status: 500,
  });
}

/**
 * `POST /api/gifts/{publicId}/checkout` (`billing-checkout` "Checkout endpoint"): the publish
 * endpoint's guards in the same order, then the checkout service.
 */
export async function handleStartCheckout(
  request: Request,
  routeContext: Readonly<{ params: Promise<{ publicId: string }> }>,
  {
    getContext = getGiftRequestContext,
    limit = enforceGiftMutationRateLimit,
    service,
  }: BillingRouteDependencies,
): Promise<Response> {
  const id = requestId(request);
  try {
    const rejectedMutation = validateJsonMutationRequest(request, id);
    if (rejectedMutation) return rejectedMutation;

    const publicId = PublicGiftIdSchema.safeParse((await routeContext.params).publicId);
    if (!publicId.success) return giftServiceErrorResponse({ code: "NOT_FOUND" }, id);

    const idempotencyKey = GiftIdempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (!idempotencyKey.success) {
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        fieldErrors: { idempotencyKey: "A UUID Idempotency-Key header is required." },
        message: "Request headers are invalid.",
        requestId: id,
        status: 400,
      });
    }

    const context = await getContext(request);
    const rateLimited = await limit(request, context, "gift-checkout", id);
    if (rateLimited) return rateLimited;

    const body = await readJsonBody(request, StartCheckoutRequestSchema, {
      maxBytes: CHECKOUT_BODY_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const result = await service().startCheckout({
      expectedRevision: body.data.expectedRevision,
      idempotencyKey: idempotencyKey.data,
      planId: body.data.planId,
      publicId: publicId.data,
      userId: context.userId,
    });
    return result.ok
      ? createApiSuccessResponse({ order: result.data }, id, 201)
      : checkoutErrorResponse(result.error, id);
  } catch (error) {
    return internalError("gift_checkout", error, id, "The checkout could not be started.");
  }
}

/** `GET /api/orders/{orderId}` (`billing-checkout` "Order status endpoint"): owner only. */
export async function handleGetOrder(
  request: Request,
  routeContext: Readonly<{ params: Promise<{ orderId: string }> }>,
  {
    getContext = getGiftRequestContext,
    limit = enforceGiftMutationRateLimit,
    service,
  }: BillingRouteDependencies,
): Promise<Response> {
  const id = requestId(request);
  try {
    const orderId = OrderIdSchema.safeParse((await routeContext.params).orderId);
    if (!orderId.success) return orderNotFound(id);

    const context = await getContext(request);
    const rateLimited = await limit(request, context, "order-read", id);
    if (rateLimited) return rateLimited;

    const result = await service().getOrder({ orderId: orderId.data, userId: context.userId });
    // `no-store`, like every API response: an order is never cached.
    return result.ok ? createApiSuccessResponse({ order: result.data }, id) : orderNotFound(id);
  } catch (error) {
    return internalError("order_read", error, id, "The order could not be read.");
  }
}
