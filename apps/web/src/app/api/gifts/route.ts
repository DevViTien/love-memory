import {
  API_ERROR_CODES,
  CreateGiftDraftRequestSchema,
  GiftIdempotencyKeySchema,
} from "@love-memory/contracts";

import { giftService } from "@/composition/gifts";
import {
  createApiErrorResponse,
  createInvalidBodyResponse,
  readJsonBody,
  validateJsonMutationRequest,
} from "@/http/api-response";
import { serializeAnonymousDraftCookie } from "@/modules/gifts/infrastructure/anonymous-draft-identity";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
  giftDraftResponse,
  giftServiceErrorResponse,
  requestId,
} from "@/modules/gifts/presentation/gift-route-helpers";

export async function POST(request: Request): Promise<Response> {
  const id = requestId(request);

  try {
    const rejectedMutation = validateJsonMutationRequest(request, id);
    if (rejectedMutation) {
      return rejectedMutation;
    }

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
    const rateLimited = await enforceGiftMutationRateLimit(request, context, "gift-create", id);
    if (rateLimited) {
      return rateLimited;
    }

    const body = await readJsonBody(request, CreateGiftDraftRequestSchema);
    if (!body.ok) {
      return createInvalidBodyResponse(body.error, id);
    }

    const result = await giftService.createDraft({
      ...(context.anonymousIdentity ? { anonymousIdentity: context.anonymousIdentity } : {}),
      idempotencyKey: idempotencyKey.data,
      ownerId: context.userId,
      templateId: body.data.templateId,
      templateVersion: body.data.templateVersion,
    });

    if (!result.ok) {
      return giftServiceErrorResponse(result.error, id);
    }

    const response = giftDraftResponse(result.data.gift, id, 201);
    if (result.data.anonymousIdentity) {
      response.headers.append(
        "Set-Cookie",
        serializeAnonymousDraftCookie(result.data.anonymousIdentity),
      );
    }
    return response;
  } catch {
    console.error(JSON.stringify({ event: "gift_draft_create_failed", requestId: id }));
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift draft could not be created.",
      requestId: id,
      status: 500,
    });
  }
}
