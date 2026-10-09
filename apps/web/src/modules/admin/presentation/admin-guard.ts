import { API_ERROR_CODES } from "@love-memory/contracts";
import { notFound, redirect } from "next/navigation";

import { createApiErrorResponse } from "@/http/api-response";

import { type AdminAccess, type AdminSession } from "../application/admin-access";

export const ADMIN_MFA_PATH = "/admin/mfa";

/**
 * Every admin page except `/admin/mfa`: a non-admin gets the application's not-found page (the
 * area never confirms it exists), an admin without a factor or a step-up goes to `/admin/mfa`.
 */
export function requireAdminPage(access: AdminAccess): AdminSession {
  if (access.kind === "none") notFound();
  if (access.kind !== "admin") redirect(ADMIN_MFA_PATH);
  return access.session;
}

/** `/admin/mfa`: any admin, enrolled or not, stepped up or not; everyone else gets not-found. */
export function requireAdminForMfa(
  access: AdminAccess,
): Exclude<AdminAccess, Readonly<{ kind: "none" }>> {
  if (access.kind === "none") notFound();
  return access;
}

/**
 * Admin API routes: `404 NOT_FOUND` (identical to an unknown API path) for non-admins, `403
 * MFA_REQUIRED` for an admin without a step-up unless the route is part of the MFA flow. Otherwise
 * the admin's session, and the request proceeds.
 */
export function requireAdminRoute(
  access: AdminAccess,
  options: Readonly<{ allowMfa: boolean; requestId: string }>,
): AdminSession | Response {
  if (access.kind === "none") {
    return createApiErrorResponse({
      code: API_ERROR_CODES.notFound,
      message: "Not found.",
      requestId: options.requestId,
      status: 404,
    });
  }
  if (access.kind !== "admin" && !options.allowMfa) {
    return createApiErrorResponse({
      code: API_ERROR_CODES.forbidden,
      details: { reason: "MFA_REQUIRED" },
      message: "A second factor is required.",
      requestId: options.requestId,
      status: 403,
    });
  }
  return access.session;
}
