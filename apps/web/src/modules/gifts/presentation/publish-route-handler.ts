import {
  API_ERROR_CODES,
  GiftIdempotencyKeySchema,
  PublicGiftIdSchema,
  PublishGiftRequestSchema,
} from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  validateJsonMutationRequest,
} from "@/http/api-response";
import { reportOperationalFailure } from "@/observability/operational-errors";

import { type createGiftService } from "../application/gift-service";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
  giftServiceErrorResponse,
  requestId,
} from "./gift-route-helpers";

/** `{ "expectedRevision": n }` needs a few bytes; anything above 1 KiB is refused unread. */
export const PUBLISH_BODY_MAX_BYTES = 1024;

export type PublishRouteDependencies = Readonly<{
  getService: () => Pick<ReturnType<typeof createGiftService>, "publishGift">;
}>;

type PublishRouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

/**
 * `POST /api/gifts/{publicId}/publish`: media type and origin, path, `Idempotency-Key`, rate
 * limit, body (at most 1 KiB), then the session, ownership and entitlement inside the service.
 * Failures log only the operation, the error class name and the request id.
 */
export async function handlePublishGift(
  request: Request,
  routeContext: PublishRouteContext,
  { getService }: PublishRouteDependencies,
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

    const context = await getGiftRequestContext(request);
    const rateLimited = await enforceGiftMutationRateLimit(request, context, "gift-publish", id);
    if (rateLimited) return rateLimited;

    const body = await readJsonBody(request, PublishGiftRequestSchema, {
      maxBytes: PUBLISH_BODY_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const result = await getService().publishGift({
      expectedRevision: body.data.expectedRevision,
      idempotencyKey: idempotencyKey.data,
      publicId: publicId.data,
      requestId: id,
      userId: context.userId,
    });
    return result.ok
      ? createApiSuccessResponse({ publication: result.data }, id, 201)
      : giftServiceErrorResponse(result.error, id);
  } catch (error) {
    // Never the public id, the share id, gift content or the error message.
    reportOperationalFailure("gift_publish", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift could not be published.",
      requestId: id,
      status: 500,
    });
  }
}
