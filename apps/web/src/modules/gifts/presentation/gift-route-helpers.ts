import { API_ERROR_CODES } from "@love-memory/contracts";
import { randomUUID } from "node:crypto";

import { createApiErrorResponse, createApiSuccessResponse } from "@/http/api-response";
import { getCurrentUser } from "@/composition/session";
import { type GiftAccessor, type GiftServiceError } from "@/modules/gifts/application/gift-service";
import {
  ANONYMOUS_DRAFT_COOKIE,
  parseAnonymousDraftIdentity,
  readCookie,
} from "@/modules/gifts/infrastructure/anonymous-draft-identity";

export async function getGiftRequestContext(request: Request): Promise<
  Readonly<{
    accessor: GiftAccessor | null;
    anonymousIdentity: ReturnType<typeof parseAnonymousDraftIdentity>;
    userId: string | null;
  }>
> {
  const [user, anonymousIdentity] = await Promise.all([
    getCurrentUser(request.headers),
    Promise.resolve(parseAnonymousDraftIdentity(readCookie(request, ANONYMOUS_DRAFT_COOKIE))),
  ]);

  return {
    accessor: user
      ? { isAdmin: user.role === "admin", kind: "user", userId: user.id }
      : anonymousIdentity
        ? {
            anonymousDraftId: anonymousIdentity.anonymousDraftId,
            claimTokenHash: anonymousIdentity.claimTokenHash,
            kind: "anonymous",
          }
        : null,
    anonymousIdentity,
    userId: user?.id ?? null,
  };
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && supplied.length <= 128 ? supplied : randomUUID();
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
