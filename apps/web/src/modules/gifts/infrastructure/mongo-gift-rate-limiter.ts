import "server-only";

import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type GiftMutationScope = "gift-claim" | "gift-create" | "gift-update" | "media-upload";

const RATE_LIMITS: Readonly<
  Record<GiftMutationScope, Readonly<{ max: number; windowSeconds: number }>>
> = {
  "gift-claim": { max: 10, windowSeconds: 5 * 60 },
  "gift-create": { max: 10, windowSeconds: 10 * 60 },
  "gift-update": { max: 60, windowSeconds: 60 },
  "media-upload": { max: 30, windowSeconds: 10 * 60 },
};

type ApiRateLimitDocument = Readonly<{
  _id: string;
  count: number;
  createdAt: Date;
  expiresAt: Date;
  scope: GiftMutationScope;
  subjectHash: string;
  updatedAt: Date;
}>;

export type GiftRateLimitResult = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Readonly<{ code?: unknown }>).code === 11000
  );
}

export async function consumeGiftMutationRateLimit(
  scope: GiftMutationScope,
  subject: string,
  secret: string,
  now = new Date(),
): Promise<GiftRateLimitResult> {
  const database = await getDatabase();
  const limit = RATE_LIMITS[scope];
  const windowMilliseconds = limit.windowSeconds * 1000;
  const bucketStart = Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds;
  const expiresAt = new Date(bucketStart + windowMilliseconds);
  const subjectHash = createHmac("sha256", secret)
    .update(`gift-mutation-rate-limit:${subject}`)
    .digest("hex");
  const id = `${scope}:${subjectHash}:${bucketStart}`;

  try {
    const document = await database
      .collection<ApiRateLimitDocument>(COLLECTIONS.apiRateLimits)
      .findOneAndUpdate(
        { _id: id, count: { $lt: limit.max } },
        {
          $inc: { count: 1 },
          $set: { updatedAt: now },
          $setOnInsert: {
            createdAt: now,
            expiresAt,
            scope,
            subjectHash,
          },
        },
        { returnDocument: "after", upsert: true },
      );

    return {
      allowed: document !== null,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
    };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
    };
  }
}

export function giftRateLimitSubject(
  request: Request,
  identity: Readonly<{ anonymousDraftId?: string; userId?: string }>,
): string | null {
  if (identity.userId) {
    return `user:${identity.userId}`;
  }
  if (identity.anonymousDraftId) {
    return `anonymous:${identity.anonymousDraftId}`;
  }

  const forwardedFor = request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwardedFor && forwardedFor.length <= 64 && isIP(forwardedFor)
    ? `ip:${forwardedFor}`
    : null;
}
