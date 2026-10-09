import { API_ERROR_CODES } from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  requestId,
  validateJsonMutationRequest,
} from "@/http/api-response";
import { type AdminAccess } from "@/modules/admin/application/admin-access";
import { requireAdminRoute } from "@/modules/admin/presentation/admin-guard";
import { reportOperationalFailure } from "@/observability/operational-errors";

import { ModerationActionRequestSchema, type ModerationService } from "../application/moderation";

export type ModerationRouteDependencies = Readonly<{
  getAccess: (headers: Headers) => Promise<AdminAccess>;
  moderation: Pick<ModerationService, "act">;
}>;

type RouteContext = Readonly<{ params: Promise<{ reportId: string }> }>;

const CONFLICT_REASONS = {
  "gift-gone": "GIFT_GONE",
  "not-taken-down": "NOT_TAKEN_DOWN",
  "report-closed": "REPORT_CLOSED",
} as const;

/**
 * `POST /api/admin/reports/{reportId}` (`abuse-reports` "Admin review queue"): the admin guard with
 * a step-up first, then media type and origin, then the strict body.
 */
export async function handleModerationAction(
  request: Request,
  routeContext: RouteContext,
  dependencies: ModerationRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const session = requireAdminRoute(await dependencies.getAccess(request.headers), {
      allowMfa: false,
      requestId: id,
    });
    if (session instanceof Response) return session;

    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;

    const body = await readJsonBody(request, ModerationActionRequestSchema, { maxBytes: 1024 });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const { reportId } = await routeContext.params;
    const result = await dependencies.moderation.act(reportId, body.data.action, {
      id: session.user.id,
      requestId: id,
    });
    if (result.kind === "not-found") {
      return createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "Report not found.",
        requestId: id,
        status: 404,
      });
    }
    if (result.kind !== "ok") {
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: CONFLICT_REASONS[result.kind] },
        message: "The report cannot take this action.",
        requestId: id,
        status: 409,
      });
    }
    return createApiSuccessResponse({ reportStatus: result.reportStatus }, id);
  } catch (error) {
    reportOperationalFailure("admin_moderation", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The moderation action could not be applied.",
      requestId: id,
      status: 500,
    });
  }
}
