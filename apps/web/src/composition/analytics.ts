import { type AnalyticsContext } from "@love-memory/contracts";
import { randomUUID } from "node:crypto";
import { after } from "next/server";

import { getAnalyticsEnvironment } from "@/config/analytics";
import {
  type AnalyticsGift,
  type AnalyticsService,
  createAnalyticsService,
} from "@/modules/analytics/application/analytics-service";
import { createGiftRefFactory } from "@/modules/analytics/infrastructure/gift-ref";
import { mongoAnalyticsEventRepository } from "@/modules/analytics/infrastructure/mongo-analytics-event-repository";
import {
  type AnalyticsRateLimitScope,
  type EventsRouteDependencies,
} from "@/modules/analytics/presentation/events-route-handler";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";
import {
  analyticsSessionSubject,
  consumeApiRateLimit,
  publicReadRateLimitSubject,
} from "@/modules/gifts/infrastructure/mongo-gift-rate-limiter";
import { reportOperationalFailure } from "@/observability/operational-errors";

let analyticsService: AnalyticsService | undefined;

/** The analytics service; the configuration is read on every call, so a fix needs no rebuild. */
export function getAnalyticsService(): AnalyticsService {
  analyticsService ??= createAnalyticsService({
    createId: randomUUID,
    events: mongoAnalyticsEventRepository,
    giftRefFactory: () => {
      const environment = getAnalyticsEnvironment();
      return environment.enabled ? createGiftRefFactory(environment.giftRefSecret) : null;
    },
  });
  return analyticsService;
}

/** The page context of an authorized gift (Studio draft, live share), or `null` while disabled. */
export function analyticsContextForGift(gift: AnalyticsGift): AnalyticsContext | null {
  return getAnalyticsService().contextForGift(gift);
}

/** The analytics counters share the mutation limits' storage and keyed subject hashing. */
export function consumeAnalyticsRateLimit(
  scope: AnalyticsRateLimitScope,
  subject: string,
): ReturnType<typeof consumeApiRateLimit> {
  return consumeApiRateLimit(scope, subject, getAuthEnvironment().secret);
}

export const eventsRouteDependencies: EventsRouteDependencies = {
  consumeRateLimit: consumeAnalyticsRateLimit,
  getService: getAnalyticsService,
  isEnabled: () => getAnalyticsEnvironment().enabled,
  networkSubject: publicReadRateLimitSubject,
  sessionSubject: analyticsSessionSubject,
};

export type GiftPublishedNotice = Readonly<{
  giftId: string;
  requestId: string;
  templateId: string;
  templateVersion: string;
}>;

export type AfterResponsePublishAnalyticsDependencies = Readonly<{
  isEnabled: () => boolean;
  now: () => Date;
  record: (gift: AnalyticsGift, now: Date) => Promise<unknown>;
  report: (operation: string, error: unknown, requestId: string) => void;
  /** Next's `after()`; it throws outside a request scope (a script or a test). */
  runAfter: (task: () => Promise<void>) => void;
}>;

/**
 * The publish service's `gift_published` port: a best-effort write after the response, so it adds
 * no latency and can never change the publish result. Without a request scope the write starts as
 * a detached promise with the same failure handling. Nothing is scheduled while disabled.
 */
export function createAfterResponsePublishAnalytics(
  dependencies: AfterResponsePublishAnalyticsDependencies,
): Readonly<{ giftPublished: (notice: GiftPublishedNotice) => void }> {
  return {
    giftPublished(notice) {
      if (!dependencies.isEnabled()) return;
      const occurredAt = dependencies.now();
      const write = async () => {
        try {
          await dependencies.record(
            {
              id: notice.giftId,
              templateId: notice.templateId,
              templateVersion: notice.templateVersion,
            },
            occurredAt,
          );
        } catch (error) {
          dependencies.report("analytics_gift_published", error, notice.requestId);
        }
      };
      try {
        dependencies.runAfter(write);
      } catch {
        void write();
      }
    },
  };
}

export const publishAnalytics = createAfterResponsePublishAnalytics({
  isEnabled: () => getAnalyticsEnvironment().enabled,
  now: () => new Date(),
  record: (gift, now) => getAnalyticsService().recordGiftPublished(gift, now),
  report: reportOperationalFailure,
  runAfter: after,
});
