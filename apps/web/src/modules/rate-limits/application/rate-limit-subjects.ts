import { isIP } from "node:net";

// Requests with no trustworthy client key (no session, no anonymous cookie and no Vercel forwarding
// header, i.e. off-Vercel hosts) share one bucket, so they are bounded rather than unlimited.
export const UNIDENTIFIED_RATE_LIMIT_SUBJECT = "unidentified";
// The anonymous cookie is only checked for shape, so anonymous requests are also charged to a
// network bucket; otherwise a fresh made-up cookie per request would reset every limit.
export const NETWORK_SUBJECT_PREFIX = "network:";

// A public read subject can be qualified by a share id (`unidentified|share:...`), and an analytics
// subject by a session id (`unidentified|session:...`).
export const SUBJECT_QUALIFIER_SEPARATOR = "|";

/** Whether many clients share this subject (`unidentified`, `network:…`). */
export function isSharedBucket(subject: string): boolean {
  const base = subject.split(SUBJECT_QUALIFIER_SEPARATOR, 1)[0];
  return base === UNIDENTIFIED_RATE_LIMIT_SUBJECT || subject.startsWith(NETWORK_SUBJECT_PREFIX);
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
