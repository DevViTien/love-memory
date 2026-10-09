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
import { reportOperationalFailure } from "@/observability/operational-errors";

import { type AbuseReportService, ReportRequestSchema } from "../application/abuse-reports";

/** A category, a share id and 1000 characters of details fit comfortably. */
export const REPORT_BODY_MAX_BYTES = 4096;

export type ReportRateLimitScope = "abuse-report" | "abuse-report-ip";

export type ReportRouteDependencies = Readonly<{
  consumeRateLimit: (
    scope: ReportRateLimitScope,
    subject: string,
  ) => Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
  isAutomated: (userAgent: string | null) => boolean;
  /** The network subject qualified by the share id. */
  linkSubject: (networkSubject: string, shareId: string) => string;
  networkSubject: (request: Request) => string;
  service: Pick<AbuseReportService, "submit">;
}>;

function accepted(id: string): Response {
  return createApiSuccessResponse({ received: true }, id, 202);
}

/**
 * `POST /api/reports` (`abuse-reports` "Report endpoint"): guards, the silent `202` for automated
 * traffic, the capped body, the per-link then per-network limits, then the live-link check. Only
 * the operation, the error name and the request id are ever logged.
 */
export async function handleReport(
  request: Request,
  dependencies: ReportRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;
    if (dependencies.isAutomated(request.headers.get("user-agent"))) return accepted(id);

    const body = await readJsonBody(request, ReportRequestSchema, {
      maxBytes: REPORT_BODY_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const network = dependencies.networkSubject(request);
    for (const [scope, subject] of [
      ["abuse-report", dependencies.linkSubject(network, body.data.shareId)],
      ["abuse-report-ip", network],
    ] as const) {
      const limit = await dependencies.consumeRateLimit(scope, subject);
      if (!limit.allowed) return createRateLimitedResponse(limit.retryAfterSeconds, id);
    }

    const outcome = await dependencies.service.submit(body.data);
    if (outcome === "not-found") {
      return createApiErrorResponse({
        code: API_ERROR_CODES.notFound,
        message: "Gift was not found.",
        requestId: id,
        status: 404,
      });
    }
    return accepted(id);
  } catch (error) {
    reportOperationalFailure("abuse_report", error, id);
    return createApiErrorResponse({
      code: API_ERROR_CODES.internal,
      message: "The report could not be stored.",
      requestId: id,
      status: 500,
    });
  }
}
