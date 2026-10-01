import { type AnalyticsContext, type AnalyticsEventRequest } from "@love-memory/contracts";

import { type AnalyticsEventRecord, createAnalyticsEventRecord } from "./analytics-event";

export interface AnalyticsEventRepository {
  insert(record: AnalyticsEventRecord): Promise<void>;
}

/** The keyed pseudonym of an internal gift id. */
export type GiftRefFactory = (giftId: string) => string;

export type AnalyticsServiceDependencies = Readonly<{
  createId: () => string;
  events: AnalyticsEventRepository;
  /** `null` while analytics is disabled: no context, no `gift_published`. Read per call. */
  giftRefFactory: () => GiftRefFactory | null;
}>;

export type AnalyticsGift = Readonly<{
  id: string;
  templateId: string;
  templateVersion: string;
}>;

export function createAnalyticsService(dependencies: AnalyticsServiceDependencies) {
  return {
    /** The page context of an authorized gift, or `null` while analytics is disabled. */
    contextForGift(gift: AnalyticsGift): AnalyticsContext | null {
      const giftRef = dependencies.giftRefFactory();
      if (!giftRef) return null;
      return {
        giftRef: giftRef(gift.id),
        templateId: gift.templateId,
        templateVersion: gift.templateVersion,
      };
    },

    /** Stores one validated browser event; the server sets the time. */
    async recordBrowserEvent(event: AnalyticsEventRequest, now: Date): Promise<void> {
      await dependencies.events.insert(
        createAnalyticsEventRecord(event, dependencies.createId(), now),
      );
    },

    /** Stores `gift_published` for a first publish; nothing while analytics is disabled. */
    async recordGiftPublished(gift: AnalyticsGift, now: Date): Promise<boolean> {
      const giftRef = dependencies.giftRefFactory();
      if (!giftRef) return false;
      await dependencies.events.insert(
        createAnalyticsEventRecord(
          {
            giftRef: giftRef(gift.id),
            name: "gift_published",
            templateId: gift.templateId,
            templateVersion: gift.templateVersion,
          },
          dependencies.createId(),
          now,
        ),
      );
      return true;
    },
  } as const;
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
