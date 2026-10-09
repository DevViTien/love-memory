/** Every rate-limited scope (`mutation-request-guards` "Distributed mutation rate limits"). */
export type ApiRateLimitScope =
  | "abuse-report"
  | "abuse-report-ip"
  | "admin-action"
  | "admin-mfa"
  | "analytics-event"
  | "analytics-event-ip"
  | "gift-claim"
  | "gift-create"
  | "gift-lifecycle"
  | "gift-read"
  | "gift-preview"
  | "gift-publish"
  | "gift-update"
  | "media-read"
  | "media-upload"
  | "media-write"
  | "public-gift-read"
  | "public-gift-read-ip";

export type RateLimitResult = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

/** Fixed-window counters shared across server instances; the subject is hashed before storage. */
export interface RateLimiter {
  consume(scope: ApiRateLimitScope, subject: string): Promise<RateLimitResult>;
}

/** Charges the subjects in order, stopping at the first one that is exhausted. */
export async function consumeAll(
  limiter: RateLimiter,
  scope: ApiRateLimitScope,
  subjects: readonly string[],
): Promise<RateLimitResult> {
  let result: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };
  for (const subject of subjects) {
    result = await limiter.consume(scope, subject);
    if (!result.allowed) break;
  }
  return result;
}
