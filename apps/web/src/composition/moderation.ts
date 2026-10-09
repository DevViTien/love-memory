import { auditService, getAdminAccess } from "@/composition/admin";
import { getPublicGiftService } from "@/composition/public-gifts";
import { isAutomatedUserAgent } from "@/modules/analytics/application/automated-traffic";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import {
  consumeApiRateLimit,
  publicReadLinkSubject,
  publicReadRateLimitSubject,
} from "@/modules/gifts/infrastructure/mongo-gift-rate-limiter";
import { createAbuseReportService } from "@/modules/moderation/application/abuse-reports";
import { createModerationService } from "@/modules/moderation/application/moderation";
import {
  mongoAbuseReportStore,
  mongoModerationRepository,
} from "@/modules/moderation/infrastructure/mongo-moderation";
import { type ModerationRouteDependencies } from "@/modules/moderation/presentation/moderation-route-handler";
import { type ReportRouteDependencies } from "@/modules/moderation/presentation/report-route-handler";

export const abuseReportService = createAbuseReportService({
  findLiveGiftId: (shareId) => getPublicGiftService().findLiveGiftId(shareId),
  reports: mongoAbuseReportStore,
});

export const moderationService = createModerationService({
  audit: auditService,
  loadContent: (giftId) => getPublicGiftService().openForReview(giftId),
  repository: mongoModerationRepository,
});

export const reportRouteDependencies: ReportRouteDependencies = {
  consumeRateLimit: (scope, subject) =>
    consumeApiRateLimit(scope, subject, getAuthEnvironment().secret),
  isAutomated: isAutomatedUserAgent,
  linkSubject: publicReadLinkSubject,
  networkSubject: publicReadRateLimitSubject,
  service: abuseReportService,
};

export const moderationRouteDependencies: ModerationRouteDependencies = {
  getAccess: getAdminAccess,
  moderation: moderationService,
};
