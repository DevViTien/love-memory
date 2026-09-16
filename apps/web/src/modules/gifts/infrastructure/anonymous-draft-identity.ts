import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import { type AnonymousDraftIdentity } from "../application/gift-service";

export const ANONYMOUS_DRAFT_COOKIE = "love_memory_anonymous_draft";
const anonymousCookieSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
  .transform((value) => {
    const separator = value.indexOf(".");
    return {
      anonymousDraftId: value.slice(0, separator),
      claimToken: value.slice(separator + 1),
    };
  })
  .pipe(
    z.object({
      anonymousDraftId: z.uuid(),
      claimToken: z.string().length(43),
    }),
  );

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createAnonymousDraftIdentity(): AnonymousDraftIdentity {
  const claimToken = randomBytes(32).toString("base64url");
  return {
    anonymousDraftId: randomUUID(),
    claimToken,
    claimTokenHash: hashClaimToken(claimToken),
  };
}

export function parseAnonymousDraftIdentity(
  cookieValue: string | undefined,
): AnonymousDraftIdentity | null {
  const parsed = anonymousCookieSchema.safeParse(cookieValue);
  if (!parsed.success) {
    return null;
  }

  return {
    ...parsed.data,
    claimTokenHash: hashClaimToken(parsed.data.claimToken),
  };
}

export function serializeAnonymousDraftCookie(identity: AnonymousDraftIdentity): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${ANONYMOUS_DRAFT_COOKIE}=${identity.anonymousDraftId}.${identity.claimToken}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = pair.slice(0, separator).trim();
    if (key === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return undefined;
}
