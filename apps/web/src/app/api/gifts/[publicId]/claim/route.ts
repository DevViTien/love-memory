import {
  API_ERROR_CODES,
  ClaimGiftDraftRequestSchema,
  PublicGiftIdSchema,
} from "@love-memory/contracts";

import { giftService } from "@/composition/gifts";
import {
  createApiErrorResponse,
  createInvalidBodyResponse,
  readJsonBody,
  validateJsonMutationRequest,
} from "@/http/api-response";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
  giftDraftResponse,
  giftServiceErrorResponse,
  requestId,
} from "@/modules/gifts/presentation/gift-route-helpers";

type ClaimRouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

export async function POST(request: Request, routeContext: ClaimRouteContext): Promise<Response> {
  const id = requestId(request);

  try {
    const rejectedMutation = validateJsonMutationRequest(request, id);
    if (rejectedMutation) {
      return rejectedMutation;
    }

    const publicId = PublicGiftIdSchema.safeParse((await routeContext.params).publicId);
    if (!publicId.success) {
      return giftServiceErrorResponse({ code: "NOT_FOUND" }, id);
    }

    const context = await getGiftRequestContext(request);
    const rateLimited = await enforceGiftMutationRateLimit(request, context, "gift-claim", id);
    if (rateLimited) {
      return rateLimited;
    }

    const body = await readJsonBody(request, ClaimGiftDraftRequestSchema);
    if (!body.ok) {
      return createInvalidBodyResponse(body.error, id);
    }

    const result = await giftService.claimDraft({
      anonymousDraftId: context.anonymousIdentity?.anonymousDraftId ?? null,
      claimTokenHash: context.anonymousIdentity?.claimTokenHash ?? null,
      publicId: publicId.data,
      userId: context.userId,
    });

    return result.ok
      ? giftDraftResponse(result.data, id)
      : giftServiceErrorResponse(result.error, id);
  } catch {
    console.error(JSON.stringify({ event: "gift_draft_claim_failed", requestId: id }));
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift draft could not be claimed.",
      requestId: id,
      status: 500,
    });
  }
}
