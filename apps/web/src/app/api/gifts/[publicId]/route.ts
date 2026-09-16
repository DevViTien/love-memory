import {
  API_ERROR_CODES,
  PublicGiftIdSchema,
  UpdateGiftDraftRequestSchema,
} from "@love-memory/contracts";

import { giftService } from "@/composition/gifts";
import {
  createApiErrorResponse,
  createInvalidBodyResponse,
  readJsonBody,
} from "@/http/api-response";
import {
  getGiftRequestContext,
  giftDraftResponse,
  giftServiceErrorResponse,
  requestId,
} from "@/modules/gifts/presentation/gift-route-helpers";

type GiftRouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

async function parsePublicId(context: GiftRouteContext, id: string): Promise<string | Response> {
  const result = PublicGiftIdSchema.safeParse((await context.params).publicId);
  return result.success
    ? result.data
    : createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "Gift draft was not found.",
        requestId: id,
        status: 404,
      });
}

export async function GET(request: Request, routeContext: GiftRouteContext): Promise<Response> {
  const id = requestId(request);

  try {
    const publicId = await parsePublicId(routeContext, id);
    if (publicId instanceof Response) {
      return publicId;
    }

    const { accessor } = await getGiftRequestContext(request);
    if (!accessor) {
      return giftServiceErrorResponse({ code: "NOT_FOUND" }, id);
    }

    const result = await giftService.getDraft({ accessor, publicId });
    return result.ok
      ? giftDraftResponse(result.data, id)
      : giftServiceErrorResponse(result.error, id);
  } catch {
    console.error(JSON.stringify({ event: "gift_draft_read_failed", requestId: id }));
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift draft could not be loaded.",
      requestId: id,
      status: 500,
    });
  }
}

export async function PATCH(request: Request, routeContext: GiftRouteContext): Promise<Response> {
  const id = requestId(request);

  try {
    const publicId = await parsePublicId(routeContext, id);
    if (publicId instanceof Response) {
      return publicId;
    }

    const body = await readJsonBody(request, UpdateGiftDraftRequestSchema);
    if (!body.ok) {
      return createInvalidBodyResponse(body.error, id);
    }

    const { accessor } = await getGiftRequestContext(request);
    if (!accessor) {
      return giftServiceErrorResponse({ code: "NOT_FOUND" }, id);
    }

    const result = await giftService.updateDraft({
      accessor,
      content: body.data.content,
      expectedRevision: body.data.expectedRevision,
      publicId,
    });

    return result.ok
      ? giftDraftResponse(result.data, id)
      : giftServiceErrorResponse(result.error, id);
  } catch {
    console.error(JSON.stringify({ event: "gift_draft_update_failed", requestId: id }));
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift draft could not be saved.",
      requestId: id,
      status: 500,
    });
  }
}
