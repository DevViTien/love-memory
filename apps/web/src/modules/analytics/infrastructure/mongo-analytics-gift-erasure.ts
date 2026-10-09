import "server-only";

import { COLLECTIONS, getDatabase } from "@love-memory/database";

import { createGiftRefFactory } from "./gift-ref";

/**
 * Deletes a deleted gift's funnel events (`gift-lifecycle`), matched by its keyed `giftRef` through
 * `analytics_events_gift_ref`. Without a configured secret no event of the gift was ever stored.
 */
export function createAnalyticsGiftErasure(getSecret: () => string | null) {
  return {
    async deleteForGift(giftId: string): Promise<void> {
      const secret = getSecret();
      if (!secret) return;
      const giftRef = createGiftRefFactory(secret)(giftId);
      await (await getDatabase()).collection(COLLECTIONS.analyticsEvents).deleteMany({ giftRef });
    },
  } as const;
}
