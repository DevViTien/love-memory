import { API_ERROR_CODES } from "@love-memory/contracts";
import { z } from "zod";

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

import { type AdminAccess } from "../application/admin-access";
import { type AdminMfaService } from "../application/admin-mfa";
import { requireAdminRoute } from "./admin-guard";

/** Both bodies are tiny; anything larger is not an MFA request. */
const ADMIN_MFA_BODY_MAX_BYTES = 1024;

const EnrollRequestSchema = z.object({}).strict();
const VerifyRequestSchema = z.object({ code: z.string().trim().min(1).max(32) }).strict();

export type AdminMfaRouteDependencies = Readonly<{
  /** Charges the `admin-mfa` counter of one admin (keyed, hashed subject). */
  consumeRateLimit: (
    subject: string,
  ) => Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
  getAccess: (headers: Headers) => Promise<AdminAccess>;
  mfa: Pick<AdminMfaService, "enroll" | "verify">;
}>;

function internalError(id: string): Response {
  return createApiErrorResponse({
    code: API_ERROR_CODES.internal,
    message: "The second factor could not be processed.",
    requestId: id,
    status: 500,
  });
}

/**
 * `POST /api/admin/mfa/enroll`: the admin guard first (a non-admin cannot tell the route exists),
 * then media type and origin, then the strict empty body. Only an admin without an enabled factor
 * gets a new secret and backup codes.
 */
export async function handleAdminMfaEnroll(
  request: Request,
  dependencies: AdminMfaRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const session = requireAdminRoute(await dependencies.getAccess(request.headers), {
      allowMfa: true,
      requestId: id,
    });
    if (session instanceof Response) return session;

    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;

    const body = await readJsonBody(request, EnrollRequestSchema, {
      maxBytes: ADMIN_MFA_BODY_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const enrollment = await dependencies.mfa.enroll(session, request.headers);
    if (enrollment.kind === "already-enabled") {
      return createApiErrorResponse({
        code: API_ERROR_CODES.conflict,
        details: { reason: "MFA_ALREADY_ENABLED" },
        message: "A second factor is already enabled.",
        requestId: id,
        status: 409,
      });
    }

    return createApiSuccessResponse(
      {
        backupCodes: enrollment.backupCodes,
        setupKey: enrollment.setupKey,
        totpUri: enrollment.totpUri,
      },
      id,
      201,
    );
  } catch (error) {
    reportOperationalFailure("admin_mfa_enroll", error, id);
    return internalError(id);
  }
}

/**
 * `POST /api/admin/mfa/verify`: the admin guard, media type and origin, the per-admin `admin-mfa`
 * limit before any code is checked, then the strict body. The code is never logged or audited.
 */
export async function handleAdminMfaVerify(
  request: Request,
  dependencies: AdminMfaRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const session = requireAdminRoute(await dependencies.getAccess(request.headers), {
      allowMfa: true,
      requestId: id,
    });
    if (session instanceof Response) return session;

    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;

    const limit = await dependencies.consumeRateLimit(`user:${session.user.id}`);
    if (!limit.allowed) return createRateLimitedResponse(limit.retryAfterSeconds, id);

    const body = await readJsonBody(request, VerifyRequestSchema, {
      maxBytes: ADMIN_MFA_BODY_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const verification = await dependencies.mfa.verify({
      code: body.data.code,
      headers: request.headers,
      requestId: id,
      session,
    });

    if (verification.kind === "locked") {
      return createRateLimitedResponse(verification.retryAfterSeconds, id);
    }
    if (verification.kind === "invalid") {
      return createApiErrorResponse({
        code: API_ERROR_CODES.validation,
        fieldErrors: { code: "The code is not valid." },
        message: "The code could not be verified.",
        requestId: id,
        status: 400,
      });
    }

    const response = createApiSuccessResponse({ verified: true }, id);
    for (const cookie of verification.setCookies) response.headers.append("Set-Cookie", cookie);
    return response;
  } catch (error) {
    reportOperationalFailure("admin_mfa_verify", error, id);
    return internalError(id);
  }
}
