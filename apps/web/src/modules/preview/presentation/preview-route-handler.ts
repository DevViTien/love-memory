import {
  API_ERROR_CODES,
  CreateGiftPreviewRequestSchema,
  PublicGiftIdSchema,
} from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  validateJsonMutationRequest,
} from "@/http/api-response";
import { reportOperationalFailure } from "@/observability/operational-errors";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
  giftServiceErrorResponse,
  requestId,
} from "@/modules/gifts/presentation/gift-route-helpers";

import { type PreviewService } from "../application/preview-service";

/** The body is `{}`; anything above 1 KiB is refused unread. */
export const PREVIEW_BODY_MAX_BYTES = 1024;

export type PreviewRouteDependencies = Readonly<{
  getService: () => PreviewService;
}>;

type PreviewRouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

/**
 * `POST /api/gifts/{publicId}/preview`: media type and origin, path, rate limit, body, then the
 * owner check. The token exists only in the `201` body and is never logged.
 */
export async function handleCreateGiftPreview(
  request: Request,
  routeContext: PreviewRouteContext,
  { getService }: PreviewRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const rejectedMutation = validateJsonMutationRequest(request, id);
    if (rejectedMutation) return rejectedMutation;

    const publicId = PublicGiftIdSchema.safeParse((await routeContext.params).publicId);
    if (!publicId.success) return giftServiceErrorResponse({ code: "NOT_FOUND" }, id);

    const context = await getGiftRequestContext(request);
    const rateLimited = await enforceGiftMutationRateLimit(request, context, "gift-preview", id);
    if (rateLimited) return rateLimited;

    const body = await readJsonBody(request, CreateGiftPreviewRequestSchema, {
      maxBytes: PREVIEW_BODY_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    if (context.accessors.length === 0) {
      return giftServiceErrorResponse({ code: "NOT_FOUND" }, id);
    }

    const result = await getService().createPreviewLink({
      accessors: context.accessors,
      publicId: publicId.data,
    });
    return result.ok
      ? createApiSuccessResponse(result.data, id, 201)
      : giftServiceErrorResponse(result.error, id);
  } catch (error) {
    // The operation, error class and request id only: never the token, ids or gift content.
    reportOperationalFailure("gift_preview_create", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The preview link could not be created.",
      requestId: id,
      status: 500,
    });
  }
}
