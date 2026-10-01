import "server-only";

import { createHmac } from "node:crypto";

import { type GiftRefFactory } from "../application/analytics-service";

/** Separates this HMAC from any other value keyed with the same secret. */
const GIFT_REF_PREFIX = "lm-gift-ref:v1:";

/**
 * `giftRef` = unpadded base64url(HMAC-SHA-256(secret, "lm-gift-ref:v1:" + giftId)): 43 characters,
 * stable while the dedicated `ANALYTICS_GIFT_REF_SECRET` is unchanged, and not reversible to the
 * gift id, public id or share id without it.
 */
export function createGiftRefFactory(secret: string): GiftRefFactory {
  return (giftId) =>
    createHmac("sha256", secret).update(`${GIFT_REF_PREFIX}${giftId}`).digest("base64url");
}
