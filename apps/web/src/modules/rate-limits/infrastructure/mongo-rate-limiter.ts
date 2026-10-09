import "server-only";

import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { createHmac } from "node:crypto";

import { isSharedBucket } from "../application/rate-limit-subjects";
import {
  type ApiRateLimitScope,
  type RateLimiter,
  type RateLimitResult,
} from "../application/rate-limiter";

type RateLimit = Readonly<{
  max: number;
  /**
   * Whether a shared subject (`unidentified`, `network:…`) gets five times `max`. Off only for a
   * subject that is never shared by many clients, such as one qualified by a browser session.
   */
  sharedBucketMultiplier?: false;
  windowSeconds: number;
}>;

const RATE_LIMITS: Readonly<Record<ApiRateLimitScope, RateLimit>> = {
  // Abuse reports (`abuse-reports`): per network and link, plus a looser per-network cap.
  "abuse-report": { max: 3, windowSeconds: 60 * 60 },
  "abuse-report-ip": { max: 20, windowSeconds: 60 * 60 },
  // Admin actions (template versions, reports, MFA enrollment): per signed-in admin.
  "admin-action": { max: 60, sharedBucketMultiplier: false, windowSeconds: 60 },
  // Admin step-up codes: per signed-in admin (`user:{id}`), on top of the factor's own lockout.
  "admin-mfa": { max: 10, sharedBucketMultiplier: false, windowSeconds: 10 * 60 },
  // Funnel events: per network subject and tab session, plus a looser per-network cap. The session
  // counter keeps 60 even for `unidentified`, because its subject includes the session id.
  "analytics-event": { max: 60, sharedBucketMultiplier: false, windowSeconds: 10 * 60 },
  "analytics-event-ip": { max: 1200, windowSeconds: 10 * 60 },
  // Checkout (`billing-checkout`): each attempt creates an order and a provider payment link.
  "gift-checkout": { max: 10, windowSeconds: 10 * 60 },
  "gift-claim": { max: 10, windowSeconds: 5 * 60 },
  "gift-create": { max: 10, windowSeconds: 10 * 60 },
  // Pause, resume and delete (`gift-lifecycle`): rare owner actions, each idempotent by state.
  "gift-lifecycle": { max: 20, windowSeconds: 10 * 60 },
  // Owner reads of a gift (`GET /api/gifts/{publicId}`, its export): generous, bounds scraping.
  "gift-read": { max: 120, windowSeconds: 60 },
  "gift-preview": { max: 30, windowSeconds: 10 * 60 },
  "gift-publish": { max: 10, windowSeconds: 10 * 60 },
  "gift-update": { max: 60, windowSeconds: 60 },
  // Owner reads and changes of photos after upload (list, read, complete, delete, retry).
  "media-read": { max: 120, windowSeconds: 60 },
  "media-upload": { max: 30, windowSeconds: 10 * 60 },
  "media-write": { max: 60, windowSeconds: 60 },
  // Order status reads: the return page polls every 3 seconds.
  "order-read": { max: 120, windowSeconds: 60 },
  // Public reads: per network subject and share id, plus a looser per-network cap, so recipients
  // behind one carrier-grade NAT address opening different gifts do not share one small budget.
  "public-gift-read": { max: 60, windowSeconds: 10 * 60 },
  "public-gift-read-ip": { max: 600, windowSeconds: 10 * 60 },
};

const SHARED_BUCKET_LIMIT_MULTIPLIER = 5;

type ApiRateLimitDocument = Readonly<{
  _id: string;
  count: number;
  createdAt: Date;
  expiresAt: Date;
  scope: ApiRateLimitScope;
  subjectHash: string;
  updatedAt: Date;
}>;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Readonly<{ code?: unknown }>).code === 11000
  );
}

export async function consumeApiRateLimit(
  scope: ApiRateLimitScope,
  subject: string,
  secret: string,
  now = new Date(),
): Promise<RateLimitResult> {
  const database = await getDatabase();
  const scopeLimit = RATE_LIMITS[scope];
  const limit =
    scopeLimit.sharedBucketMultiplier !== false && isSharedBucket(subject)
      ? { ...scopeLimit, max: scopeLimit.max * SHARED_BUCKET_LIMIT_MULTIPLIER }
      : scopeLimit;
  const windowMilliseconds = limit.windowSeconds * 1000;
  const bucketStart = Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds;
  const expiresAt = new Date(bucketStart + windowMilliseconds);
  const subjectHash = createHmac("sha256", secret)
    .update(`gift-mutation-rate-limit:${subject}`)
    .digest("hex");
  const id = `${scope}:${subjectHash}:${bucketStart}`;

  const counters = database.collection<ApiRateLimitDocument>(COLLECTIONS.apiRateLimits);
  const filter = { _id: id, count: { $lt: limit.max } };
  const increment = { $inc: { count: 1 }, $set: { updatedAt: now } };
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));

  let document: ApiRateLimitDocument | null;
  try {
    document = await counters.findOneAndUpdate(
      filter,
      { ...increment, $setOnInsert: { createdAt: now, expiresAt, scope, subjectHash } },
      { returnDocument: "after", upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    // The filter is not a pure equality match, so MongoDB does not retry the upsert itself: a
    // concurrent request created the counter first, or the counter is full. Charge the existing
    // counter; `null` then means it is genuinely exhausted.
    document = await counters.findOneAndUpdate(filter, increment, {
      returnDocument: "after",
      upsert: false,
    });
  }

  return { allowed: document !== null, retryAfterSeconds };
}

/** The `RateLimiter` port over `apiRateLimits`, keyed with the server secret. */
export function createMongoRateLimiter(getSecret: () => string): RateLimiter {
  return { consume: (scope, subject) => consumeApiRateLimit(scope, subject, getSecret()) };
}
