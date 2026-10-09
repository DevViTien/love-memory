import { API_ERROR_CODES, PublicGiftIdSchema } from "@love-memory/contracts";

import { createApiErrorResponse, requestId } from "@/http/api-response";
import { reportOperationalFailure } from "@/observability/operational-errors";

import { type GiftExportService } from "../application/gift-export";
import { type GiftAccessor } from "../application/gift-service";

export type GiftExportRouteDependencies = Readonly<{
  getAccessors: (request: Request) => Promise<readonly GiftAccessor[]>;
  /** Charges the owner's `gift-update` counters; a `Response` refuses the request. */
  limit: (request: Request, requestId: string) => Promise<Response | null>;
  service: Pick<GiftExportService, "export">;
}>;

type RouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

function notFound(id: string): Response {
  return createApiErrorResponse({
    code: API_ERROR_CODES.notFound,
    message: "Gift was not found.",
    requestId: id,
    status: 404,
  });
}

/**
 * `GET /api/gifts/{publicId}/export` (`privacy-notice` "Owner export"): a JSON attachment for the
 * owner only. The export itself is never logged.
 */
export async function handleGiftExport(
  request: Request,
  routeContext: RouteContext,
  dependencies: GiftExportRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const publicId = PublicGiftIdSchema.safeParse((await routeContext.params).publicId);
    if (!publicId.success) return notFound(id);

    const limited = await dependencies.limit(request, id);
    if (limited) return limited;

    const exported = await dependencies.service.export(
      publicId.data,
      await dependencies.getAccessors(request),
    );
    if (!exported) return notFound(id);

    return new Response(`${JSON.stringify(exported, null, 2)}\n`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="love-memory-${publicId.data}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "x-request-id": id,
      },
      status: 200,
    });
  } catch (error) {
    reportOperationalFailure("gift_export", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The gift could not be exported.",
      requestId: id,
      status: 500,
    });
  }
}
