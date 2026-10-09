import { API_ERROR_CODES } from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  createInvalidBodyResponse,
  createRateLimitedResponse,
  readJsonBody,
  requestId,
  validateJsonMutationRequest,
} from "@/http/api-response";
import { type AdminAccess } from "@/modules/admin/application/admin-access";
import { requireAdminRoute } from "@/modules/admin/presentation/admin-guard";
import { reportOperationalFailure } from "@/observability/operational-errors";

import {
  TemplateVersionActionRequestSchema,
  type TemplateVersionControls,
} from "../application/template-version-controls";

const TEMPLATE_VERSION_ACTION_MAX_BYTES = 1024;

export type TemplateVersionRouteDependencies = Readonly<{
  controls: Pick<TemplateVersionControls, "apply">;
  getAccess: (headers: Headers) => Promise<AdminAccess>;
  /** Charges the admin's `admin-action` counter. */
  limit: (userId: string) => Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
}>;

/**
 * `POST /api/admin/template-versions` (`template-version-controls`): the admin guard first (a
 * stepped-up admin only), then media type and origin, then the strict body.
 */
export async function handleTemplateVersionAction(
  request: Request,
  dependencies: TemplateVersionRouteDependencies,
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
    const limit = await dependencies.limit(session.user.id);
    if (!limit.allowed) return createRateLimitedResponse(limit.retryAfterSeconds, id);

    const body = await readJsonBody(request, TemplateVersionActionRequestSchema, {
      maxBytes: TEMPLATE_VERSION_ACTION_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const result = await dependencies.controls.apply(body.data, {
      id: session.user.id,
      requestId: id,
    });
    if (result.kind === "not-found") {
      return createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "Template version not found.",
        requestId: id,
        status: 404,
      });
    }
    if (result.kind === "not-released") {
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "VERSION_NOT_RELEASED" },
        message: "A draft template version cannot be changed here.",
        requestId: id,
        status: 409,
      });
    }

    const { version } = result;
    return createApiSuccessResponse(
      {
        changed: result.changed,
        killReason: version.killReason,
        killed: version.killed,
        status: version.status,
        templateId: version.templateId,
        version: version.version,
      },
      id,
    );
  } catch (error) {
    reportOperationalFailure("admin_template_version", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The template version could not be changed.",
      requestId: id,
      status: 500,
    });
  }
}
