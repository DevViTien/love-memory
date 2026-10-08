import { API_ERROR_CODES } from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createRateLimitedResponse,
} from "@/http/api-response";
import { getCurrentUser } from "@/composition/session";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import { type GiftAccessor, type GiftServiceError } from "@/modules/gifts/application/gift-service";
import {
  ANONYMOUS_DRAFT_COOKIE,
  parseAnonymousDraftIdentity,
  readCookie,
} from "@/modules/gifts/infrastructure/anonymous-draft-identity";
import {
  consumeApiRateLimit,
  giftRateLimitSubjects,
  type ApiRateLimitScope,
} from "@/modules/gifts/infrastructure/mongo-gift-rate-limiter";

export { requestId } from "@/http/api-response";

export type GiftRequestContext = Readonly<{
  accessors: readonly GiftAccessor[];
  anonymousIdentity: ReturnType<typeof parseAnonymousDraftIdentity>;
  userId: string | null;
}>;

/** The draft credentials a page request presents: its session and its anonymous draft cookie. */
export async function getGiftRequestContextFromHeaders(
  headers: Headers,
): Promise<GiftRequestContext> {
  const [user, anonymousIdentity] = await Promise.all([
    getCurrentUser(headers),
    Promise.resolve(parseAnonymousDraftIdentity(readCookie({ headers }, ANONYMOUS_DRAFT_COOKIE))),
  ]);

  const accessors: GiftAccessor[] = [];
  if (user) {
    // Roles grant no draft access; admin access arrives with MFA and audit in the admin work.
    accessors.push({ kind: "user", userId: user.id });
  }
  if (anonymousIdentity) {
    accessors.push({
      anonymousDraftId: anonymousIdentity.anonymousDraftId,
      claimTokenHash: anonymousIdentity.claimTokenHash,
      kind: "anonymous",
    });
  }

  return {
    accessors,
    anonymousIdentity,
    userId: user?.id ?? null,
  };
}

export function getGiftRequestContext(request: Request): Promise<GiftRequestContext> {
  return getGiftRequestContextFromHeaders(request.headers);
}

export async function enforceGiftMutationRateLimit(
  request: Request,
  context: GiftRequestContext,
  scope: ApiRateLimitScope,
  id: string,
): Promise<Response | null> {
  const subjects = giftRateLimitSubjects(request, {
    ...(context.anonymousIdentity
      ? { anonymousDraftId: context.anonymousIdentity.anonymousDraftId }
      : {}),
    ...(context.userId ? { userId: context.userId } : {}),
  });
  let result: Awaited<ReturnType<typeof consumeApiRateLimit>> | null = null;
  for (const subject of subjects) {
    result = await consumeApiRateLimit(scope, subject, getAuthEnvironment().secret);
    if (!result.allowed) break;
  }
  if (!result || result.allowed) {
    return null;
  }
  return createRateLimitedResponse(result.retryAfterSeconds, id);
}

export function giftServiceErrorResponse(error: GiftServiceError, id: string): Response {
  return mapGiftServiceError(error, id);
}

function mapGiftServiceError(error: GiftServiceError, id: string): Response {
  switch (error.code) {
    case "INVALID_CONTENT":
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        fieldErrors: error.fieldErrors,
        message: "Gift content does not match this template version.",
        requestId: id,
        status: 400,
      });
    case "INVALID_STATE":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        message: "The gift is not in a state that allows this operation.",
        requestId: id,
        status: 409,
      });
    case "IDEMPOTENCY_CONFLICT":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        message: "This idempotency key is already associated with another request.",
        requestId: id,
        status: 409,
      });
    case "NOT_AUTHENTICATED":
      return createApiErrorResponse({
        code: API_ERROR_CODES.unauthorized,
        message: "Authentication is required.",
        requestId: id,
        status: 401,
      });
    case "NOT_FOUND":
      return createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "Gift draft was not found.",
        requestId: id,
        status: 404,
      });
    case "GIFT_EXPIRED":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "GIFT_EXPIRED" },
        message: "This gift has expired and cannot be updated.",
        requestId: id,
        status: 409,
      });
    case "PLAN_NOT_AVAILABLE":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "PLAN_NOT_AVAILABLE" },
        message: "This plan is not available.",
        requestId: id,
        status: 409,
      });
    case "PLAN_CHANGE_UNSUPPORTED":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "PLAN_CHANGE_UNSUPPORTED" },
        message: "A published gift keeps the plan it was published on.",
        requestId: id,
        status: 409,
      });
    case "PLAN_PHOTO_LIMIT_EXCEEDED":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: {
          maxPhotos: error.maxPhotos,
          photoCount: error.photoCount,
          reason: "PLAN_PHOTO_LIMIT_EXCEEDED",
        },
        message: "The gift has more photos than its plan allows.",
        requestId: id,
        status: 409,
      });
    case "ACCESS_POLICY_UNSUPPORTED":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "ACCESS_POLICY_UNSUPPORTED" },
        message: "This gift's access policy cannot be published yet.",
        requestId: id,
        status: 409,
      });
    case "NO_UNPUBLISHED_CHANGES":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "NO_UNPUBLISHED_CHANGES" },
        message: "Recipients already receive this revision.",
        requestId: id,
        status: 409,
      });
    case "TEMPLATE_NOT_EDITABLE":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "TEMPLATE_VERSION_NOT_EDITABLE" },
        message: "This template version is no longer editable.",
        requestId: id,
        status: 409,
      });
    case "TEMPLATE_UNPUBLISHABLE":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "TEMPLATE_VERSION_UNPUBLISHABLE" },
        message: "This template version cannot be published.",
        requestId: id,
        status: 409,
      });
    case "REVISION_CONFLICT":
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: {
          actualRevision: error.actualRevision,
          expectedRevision: error.expectedRevision,
        },
        message: "This draft has a newer revision. Reload before saving again.",
        requestId: id,
        status: 409,
      });
  }
}

export function giftDraftResponse(gift: unknown, id: string, status = 200): Response {
  return createApiSuccessResponse({ gift }, id, status);
}
