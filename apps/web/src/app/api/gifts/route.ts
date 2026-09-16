import { API_ERROR_CODES, CreateGiftDraftRequestSchema } from "@love-memory/contracts";

import { giftService } from "@/composition/gifts";
import {
  createApiErrorResponse,
  createInvalidBodyResponse,
  readJsonBody,
} from "@/http/api-response";
import { serializeAnonymousDraftCookie } from "@/modules/gifts/infrastructure/anonymous-draft-identity";
import {
  getGiftRequestContext,
  giftDraftResponse,
  giftServiceErrorResponse,
  requestId,
} from "@/modules/gifts/presentation/gift-route-helpers";

export async function POST(request: Request): Promise<Response> {
  const id = requestId(request);

  try {
    const body = await readJsonBody(request, CreateGiftDraftRequestSchema);
    if (!body.ok) {
      return createInvalidBodyResponse(body.error, id);
    }

    const context = await getGiftRequestContext(request);
    const result = await giftService.createDraft({
      ...(context.anonymousIdentity ? { anonymousIdentity: context.anonymousIdentity } : {}),
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
