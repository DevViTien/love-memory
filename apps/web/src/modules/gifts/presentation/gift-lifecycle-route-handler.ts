import { API_ERROR_CODES, PublicGiftIdSchema } from "@love-memory/contracts";
import { z } from "zod";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  requestId,
  validateJsonMutationRequest,
} from "@/http/api-response";
import { reportOperationalFailure } from "@/observability/operational-errors";

import { type GiftLifecycleError, type GiftLifecycleService } from "../application/gift-lifecycle";
import { type GiftAccessor } from "../application/gift-service";

const LIFECYCLE_BODY_MAX_BYTES = 1024;
const EmptyBodySchema = z.object({}).strict();

export type GiftLifecycleAction = "delete" | "pause" | "resume";

export type GiftLifecycleRouteDependencies = Readonly<{
  /** The request's draft accessors (session and anonymous draft cookie). */
  getAccessors: (request: Request) => Promise<readonly GiftAccessor[]>;
  /** Charges the `gift-lifecycle` counters; a `Response` refuses the request. */
  limit: (request: Request, requestId: string) => Promise<Response | null>;
  service: Pick<GiftLifecycleService, "deleteGift" | "pause" | "resume">;
}>;

type RouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

function errorResponse(error: GiftLifecycleError, id: string): Response {
  if (error.code === "NOT_FOUND") {
    return createApiErrorResponse({
      code: API_ERROR_CODES.notFound,
      message: "Gift was not found.",
      requestId: id,
      status: 404,
    });
  }
  return createApiErrorResponse({
    code: API_ERROR_CODES.conflict,
    details: { reason: error.code },
    message:
      error.code === "GIFT_EXPIRED"
        ? "The gift has expired and cannot be shared again."
        : error.code === "GIFT_TAKEN_DOWN"
          ? "The gift is held paused after a report."
          : "The gift has not been published.",
    requestId: id,
    status: 409,
  });
}

/**
 * `POST /api/gifts/{publicId}/pause|resume|delete` (`gift-lifecycle`): media type and origin, path,
 * the `gift-lifecycle` limit, the strict empty body, then ownership and state in the service.
 */
export async function handleGiftLifecycle(
  action: GiftLifecycleAction,
  request: Request,
  routeContext: RouteContext,
  dependencies: GiftLifecycleRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;

    const publicId = PublicGiftIdSchema.safeParse((await routeContext.params).publicId);
    if (!publicId.success) return errorResponse({ code: "NOT_FOUND" }, id);

    const limited = await dependencies.limit(request, id);
    if (limited) return limited;

    const body = await readJsonBody(request, EmptyBodySchema, {
      maxBytes: LIFECYCLE_BODY_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const accessors = await dependencies.getAccessors(request);
    if (action === "delete") {
      const result = await dependencies.service.deleteGift(publicId.data, accessors);
      return result.ok
        ? createApiSuccessResponse({ deletion: result.data }, id, 202)
        : errorResponse(result.error, id);
    }
    const result = await dependencies.service[action](publicId.data, accessors);
    return result.ok
      ? createApiSuccessResponse({ gift: result.data }, id)
      : errorResponse(result.error, id);
  } catch (error) {
    reportOperationalFailure(`gift_${action}`, error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift could not be changed.",
      requestId: id,
      status: 500,
    });
  }
}
