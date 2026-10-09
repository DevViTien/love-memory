import { getAuth } from "@/composition/auth";
import { rateLimiter } from "@/composition/rate-limits";
import { getCurrentSession } from "@/composition/session";
import { templateVersionControls } from "@/composition/templates";
import { type AdminAccess, resolveAdminAccess } from "@/modules/admin/application/admin-access";
import { createAdminMfaService } from "@/modules/admin/application/admin-mfa";
import { createAuditService } from "@/modules/admin/application/audit";
import { createGiftLookupService } from "@/modules/admin/application/gift-lookup";
import { createOrderLookupService } from "@/modules/billing/application/order-lookup";
import { mongoAdminOrderLookup } from "@/modules/billing/infrastructure/mongo-order-repository";
import { createBetterAuthAdminFactor } from "@/modules/admin/infrastructure/better-auth-admin-factor";
import { mongoAdminGiftLookup } from "@/modules/admin/infrastructure/mongo-admin-gift-lookup";
import { mongoAdminMfaLockout } from "@/modules/admin/infrastructure/mongo-admin-mfa-lockout";
import { mongoAdminStepUps } from "@/modules/admin/infrastructure/mongo-admin-step-ups";
import { mongoAuditLog } from "@/modules/admin/infrastructure/mongo-audit-log";
import { type AdminMfaRouteDependencies } from "@/modules/admin/presentation/admin-mfa-route-handlers";
import { type TemplateVersionRouteDependencies } from "@/modules/templates/presentation/template-version-route-handler";

export const auditService = createAuditService({ repository: mongoAuditLog });

export const orderLookupService = createOrderLookupService({
  audit: auditService,
  repository: mongoAdminOrderLookup,
});

export const giftLookupService = createGiftLookupService({
  audit: auditService,
  repository: mongoAdminGiftLookup,
});

/** The admin-area decision for this request (`admin-access`), before any admin data is read. */
export async function getAdminAccess(requestHeaders: Headers): Promise<AdminAccess> {
  return resolveAdminAccess({
    now: new Date(),
    session: await getCurrentSession(requestHeaders),
    stepUps: mongoAdminStepUps,
  });
}

/** One `admin-action` budget per admin for every admin action route. */
export function limitAdminAction(userId: string) {
  return rateLimiter.consume("admin-action", `user:${userId}`);
}

const adminMfaService = createAdminMfaService({
  audit: auditService,
  factor: createBetterAuthAdminFactor(async () => {
    const { api } = await getAuth();
    return {
      enableTwoFactor: (input) => api.enableTwoFactor(input),
      getSession: (input) => api.getSession(input),
      verifyBackupCode: (input) => api.verifyBackupCode(input),
      verifyTOTP: (input) => api.verifyTOTP(input),
    };
  }),
  lockout: mongoAdminMfaLockout,
  stepUps: mongoAdminStepUps,
});

export const adminMfaRouteDependencies: AdminMfaRouteDependencies = {
  consumeRateLimit: (subject) => rateLimiter.consume("admin-mfa", subject),
  getAccess: getAdminAccess,
  limitAction: limitAdminAction,
  mfa: adminMfaService,
};

export const templateVersionRouteDependencies: TemplateVersionRouteDependencies = {
  controls: templateVersionControls,
  getAccess: getAdminAccess,
  limit: limitAdminAction,
};
