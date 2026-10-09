import { getAuth } from "@/composition/auth";
import { getCurrentSession } from "@/composition/session";
import { templateVersionControls } from "@/composition/templates";
import { type AdminAccess, resolveAdminAccess } from "@/modules/admin/application/admin-access";
import { createAdminMfaService } from "@/modules/admin/application/admin-mfa";
import { createAuditService } from "@/modules/admin/application/audit";
import { createGiftLookupService } from "@/modules/admin/application/gift-lookup";
import { createBetterAuthAdminFactor } from "@/modules/admin/infrastructure/better-auth-admin-factor";
import { mongoAdminGiftLookup } from "@/modules/admin/infrastructure/mongo-admin-gift-lookup";
import { mongoAdminMfaLockout } from "@/modules/admin/infrastructure/mongo-admin-mfa-lockout";
import { mongoAdminStepUps } from "@/modules/admin/infrastructure/mongo-admin-step-ups";
import { mongoAuditLog } from "@/modules/admin/infrastructure/mongo-audit-log";
import { type AdminMfaRouteDependencies } from "@/modules/admin/presentation/admin-mfa-route-handlers";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import { consumeApiRateLimit } from "@/modules/gifts/infrastructure/mongo-gift-rate-limiter";
import { type TemplateVersionRouteDependencies } from "@/modules/templates/presentation/template-version-route-handler";

export const auditService = createAuditService({ repository: mongoAuditLog });

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
  consumeRateLimit: (subject) =>
    consumeApiRateLimit("admin-mfa", subject, getAuthEnvironment().secret),
  getAccess: getAdminAccess,
  mfa: adminMfaService,
};

export const templateVersionRouteDependencies: TemplateVersionRouteDependencies = {
  controls: templateVersionControls,
  getAccess: getAdminAccess,
};
