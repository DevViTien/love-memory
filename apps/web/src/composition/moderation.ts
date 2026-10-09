import { auditService, getAdminAccess, limitAdminAction } from "@/composition/admin";
import { getPublicGiftService } from "@/composition/public-gifts";
import { isAutomatedUserAgent } from "@/modules/analytics/application/automated-traffic";
import { rateLimiter } from "@/composition/rate-limits";
import {
  publicReadLinkSubject,
  publicReadRateLimitSubject,
} from "@/modules/rate-limits/application/rate-limit-subjects";
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
  consumeRateLimit: (scope, subject) => rateLimiter.consume(scope, subject),
  isAutomated: isAutomatedUserAgent,
  linkSubject: publicReadLinkSubject,
  networkSubject: publicReadRateLimitSubject,
  service: abuseReportService,
};

export const moderationRouteDependencies: ModerationRouteDependencies = {
  getAccess: getAdminAccess,
  limit: limitAdminAction,
  moderation: moderationService,
};
