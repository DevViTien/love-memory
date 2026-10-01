import "server-only";

import { COLLECTIONS, getDatabase } from "@love-memory/database";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type ApiRateLimitScope =
  | "analytics-event"
  | "analytics-event-ip"
  | "gift-claim"
  | "gift-create"
  | "gift-preview"
  | "gift-publish"
  | "gift-update"
  | "media-upload"
  | "public-gift-read"
  | "public-gift-read-ip";

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
  // Funnel events: per network subject and tab session, plus a looser per-network cap. The session
  // counter keeps 60 even for `unidentified`, because its subject includes the session id.
  "analytics-event": { max: 60, sharedBucketMultiplier: false, windowSeconds: 10 * 60 },
  "analytics-event-ip": { max: 1200, windowSeconds: 10 * 60 },
  "gift-claim": { max: 10, windowSeconds: 5 * 60 },
  "gift-create": { max: 10, windowSeconds: 10 * 60 },
  "gift-preview": { max: 30, windowSeconds: 10 * 60 },
  "gift-publish": { max: 10, windowSeconds: 10 * 60 },
  "gift-update": { max: 60, windowSeconds: 60 },
  "media-upload": { max: 30, windowSeconds: 10 * 60 },
  // Public reads: per network subject and share id, plus a looser per-network cap, so recipients
  // behind one carrier-grade NAT address opening different gifts do not share one small budget.
  "public-gift-read": { max: 60, windowSeconds: 10 * 60 },
  "public-gift-read-ip": { max: 600, windowSeconds: 10 * 60 },
};

// Requests with no trustworthy client key (no session, no anonymous cookie and no Vercel forwarding
// header, i.e. off-Vercel hosts) share one bucket, so they are bounded rather than unlimited.
export const UNIDENTIFIED_RATE_LIMIT_SUBJECT = "unidentified";
// The anonymous cookie is only checked for shape, so anonymous requests are also charged to a
// network bucket; otherwise a fresh made-up cookie per request would reset every limit.
const NETWORK_SUBJECT_PREFIX = "network:";
const SHARED_BUCKET_LIMIT_MULTIPLIER = 5;

// A public read subject can be qualified by a share id (`unidentified|share:...`), and an analytics
// subject by a session id (`unidentified|session:...`).
const SUBJECT_QUALIFIER_SEPARATOR = "|";

function isSharedBucket(subject: string): boolean {
  const base = subject.split(SUBJECT_QUALIFIER_SEPARATOR, 1)[0];
  return base === UNIDENTIFIED_RATE_LIMIT_SUBJECT || subject.startsWith(NETWORK_SUBJECT_PREFIX);
}

type ApiRateLimitDocument = Readonly<{
  _id: string;
  count: number;
  createdAt: Date;
  expiresAt: Date;
  scope: ApiRateLimitScope;
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

export async function consumeApiRateLimit(
  scope: ApiRateLimitScope,
  subject: string,
  secret: string,
  now = new Date(),
): Promise<GiftRateLimitResult> {
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

/**
 * The client address from `x-vercel-forwarded-for`, trusted only on Vercel, where the platform
 * sets it. On any other host a client could send it, so it is ignored there.
 */
function trustedForwardedAddress(request: Request): string | null {
  if (process.env["VERCEL"] !== "1") return null;
  const forwardedFor = request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwardedFor && forwardedFor.length <= 64 && isIP(forwardedFor) ? forwardedFor : null;
}

function networkSubject(request: Request): string {
  const address = trustedForwardedAddress(request);
  return address ? `ip:${address}` : UNIDENTIFIED_RATE_LIMIT_SUBJECT;
}

/** The eight hextets of a valid IPv6 address, as numbers. */
function expandIpv6(address: string): number[] {
  const [withoutZone = ""] = address.split("%", 1);
  const toHextets = (part: string): number[] => {
    if (part === "") return [];
    return part.split(":").flatMap((group) => {
      if (!group.includes(".")) return [Number.parseInt(group, 16)];
      // An embedded IPv4 tail (`::ffff:192.0.2.1`) holds the last two hextets.
      const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
      return [a * 256 + b, c * 256 + d];
    });
  };
  const [head = "", tail] = withoutZone.split("::");
  const headHextets = toHextets(head);
  if (tail === undefined) return headHextets;
  const tailHextets = toHextets(tail);
  const zeros = new Array<number>(8 - headHextets.length - tailHextets.length).fill(0);
  return [...headHextets, ...zeros, ...tailHextets];
}

/**
 * The network subject of a public gift read: the trusted client IPv4 address, or the `/64` prefix
 * of an IPv6 address (a device or household usually holds a whole `/64`, and privacy extensions
 * rotate the low bits). Sessions and cookies are never used: a recipient has neither.
 */
export function publicReadRateLimitSubject(request: Request): string {
  const address = trustedForwardedAddress(request);
  if (!address) return UNIDENTIFIED_RATE_LIMIT_SUBJECT;
  if (isIP(address) === 4) return `ip:${address}`;

  const hextets = expandIpv6(address);
  const isIpv4Mapped = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
  if (isIpv4Mapped) {
    const [high = 0, low = 0] = hextets.slice(6);
    return `ip:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `ip6:${hextets
    .slice(0, 4)
    .map((hextet) => hextet.toString(16))
    .join(":")}::/64`;
}

/** The per-session subject of a funnel event: the network subject qualified by the session id. */
export function analyticsSessionSubject(networkSubjectValue: string, sessionId: string): string {
  return `${networkSubjectValue}${SUBJECT_QUALIFIER_SEPARATOR}session:${sessionId}`;
}

/** The per-link subject of a public read: the network subject qualified by the share id. */
export function publicReadLinkSubject(networkSubjectValue: string, shareId: string): string {
  return `${networkSubjectValue}${SUBJECT_QUALIFIER_SEPARATOR}share:${shareId}`;
}

/** Subjects to charge, primary first. A request is rejected when any of them is exhausted. */
export function giftRateLimitSubjects(
  request: Request,
  identity: Readonly<{ anonymousDraftId?: string; userId?: string }>,
): readonly string[] {
  if (identity.userId) {
    return [`user:${identity.userId}`];
  }
  if (identity.anonymousDraftId) {
    return [
      `anonymous:${identity.anonymousDraftId}`,
      `${NETWORK_SUBJECT_PREFIX}${networkSubject(request)}`,
    ];
  }
  return [networkSubject(request)];
}
