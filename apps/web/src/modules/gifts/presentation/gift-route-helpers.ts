import { API_ERROR_CODES } from "@love-memory/contracts";
import { randomUUID } from "node:crypto";

import { createApiErrorResponse, createApiSuccessResponse } from "@/http/api-response";
import { getCurrentUser } from "@/composition/session";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import { type GiftAccessor, type GiftServiceError } from "@/modules/gifts/application/gift-service";
import {
  ANONYMOUS_DRAFT_COOKIE,
  parseAnonymousDraftIdentity,
  readCookie,
} from "@/modules/gifts/infrastructure/anonymous-draft-identity";
import {
  consumeGiftMutationRateLimit,
  giftRateLimitSubject,
  type GiftMutationScope,
} from "@/modules/gifts/infrastructure/mongo-gift-rate-limiter";

export async function getGiftRequestContext(request: Request): Promise<
  Readonly<{
    accessors: readonly GiftAccessor[];
    anonymousIdentity: ReturnType<typeof parseAnonymousDraftIdentity>;
    userId: string | null;
  }>
> {
  const [user, anonymousIdentity] = await Promise.all([
    getCurrentUser(request.headers),
    Promise.resolve(parseAnonymousDraftIdentity(readCookie(request, ANONYMOUS_DRAFT_COOKIE))),
  ]);

  const accessors: GiftAccessor[] = [];
  if (user) {
    accessors.push({ isAdmin: user.role === "admin", kind: "user", userId: user.id });
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

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && supplied.length <= 128 ? supplied : randomUUID();
}

export async function enforceGiftMutationRateLimit(
  request: Request,
  context: Awaited<ReturnType<typeof getGiftRequestContext>>,
  scope: GiftMutationScope,
  id: string,
): Promise<Response | null> {
  const subject = giftRateLimitSubject(request, {
    ...(context.anonymousIdentity
      ? { anonymousDraftId: context.anonymousIdentity.anonymousDraftId }
      : {}),
    ...(context.userId ? { userId: context.userId } : {}),
  });
  if (!subject) {
    return null;
  }

  const result = await consumeGiftMutationRateLimit(scope, subject, getAuthEnvironment().secret);
  if (result.allowed) {
    return null;
  }

  const response = createApiErrorResponse({
    code: API_ERROR_CODES.rateLimited,
    details: { retryAfterSeconds: result.retryAfterSeconds },
    message: "Too many requests. Please try again later.",
    requestId: id,
    status: 429,
  });
  response.headers.set("Retry-After", String(result.retryAfterSeconds));
  return response;
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
