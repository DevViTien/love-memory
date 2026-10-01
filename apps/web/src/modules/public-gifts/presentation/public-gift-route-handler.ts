import { API_ERROR_CODES, ShareIdSchema } from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createRateLimitedResponse,
  requestId,
} from "@/http/api-response";
// Pure subject helpers, kept next to the shared-bucket rule they must agree with.
import {
  publicReadLinkSubject,
  publicReadRateLimitSubject,
} from "@/modules/gifts/infrastructure/mongo-gift-rate-limiter";

import { reportOperationalFailure } from "@/observability/operational-errors";

import { type PublicGiftService } from "../application/public-gift-service";

export type PublicReadRateLimitScope = "public-gift-read" | "public-gift-read-ip";

export type PublicGiftRouteDependencies = Readonly<{
  /** Charges one counter (keyed, hashed subject); wired in `composition/public-gifts.ts`. */
  consumeRateLimit: (
    scope: PublicReadRateLimitScope,
    subject: string,
  ) => Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
  getService: () => Pick<PublicGiftService, "openPublicGift">;
}>;

type PublicGiftRouteContext = Readonly<{ params: Promise<{ shareId: string }> }>;

function notFound(id: string): Response {
  // One answer for every cause: unknown, malformed, unpublished or unreadable.
  return createApiErrorResponse({
    code: API_ERROR_CODES.notFound,
    message: "Gift was not found.",
    requestId: id,
    status: 404,
  });
}

/**
 * `GET /api/public-gifts/{shareId}`: the format check, then two rate-limit counters (per network
 * and link, then per network), then the snapshot's viewer payload. Responses are `no-store`, and
 * logs never hold the share id, content or signed URLs.
 */
export async function handleGetPublicGift(
  request: Request,
  routeContext: PublicGiftRouteContext,
  { consumeRateLimit, getService }: PublicGiftRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const shareId = ShareIdSchema.safeParse((await routeContext.params).shareId);
    if (!shareId.success) return notFound(id);

    const subject = publicReadRateLimitSubject(request);
    let limit = await consumeRateLimit(
      "public-gift-read",
      publicReadLinkSubject(subject, shareId.data),
    );
    if (limit.allowed) {
      limit = await consumeRateLimit("public-gift-read-ip", subject);
    }
    if (!limit.allowed) return createRateLimitedResponse(limit.retryAfterSeconds, id);

    const viewer = await getService().openPublicGift(shareId.data);
    return viewer ? createApiSuccessResponse({ viewer }, id) : notFound(id);
  } catch (error) {
    // The operation, the error class name and the request id only: never the share id.
    reportOperationalFailure("public_gift_read", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift could not be loaded.",
      requestId: id,
      status: 500,
    });
  }
}
