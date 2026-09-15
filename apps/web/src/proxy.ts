import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { getWebEnvironment } from "@/config/environment";
import {
  createContentSecurityPolicy,
  getContentSecurityPolicyMode,
} from "@/security/content-security-policy";

export function proxy(request: NextRequest) {
  const mode = getContentSecurityPolicyMode(request.nextUrl.pathname);
  const nonce = mode === "nonce" ? Buffer.from(randomUUID()).toString("base64") : undefined;
  const { assetOrigin } = getWebEnvironment();
  const contentSecurityPolicy = createContentSecurityPolicy({
    ...(assetOrigin ? { assetOrigin } : {}),
    isDevelopment: process.env["NODE_ENV"] !== "production",
    mode,
    ...(nonce ? { nonce } : {}),
  });
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.delete("x-nonce");

  if (nonce) {
    requestHeaders.set("x-nonce", nonce);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    {
      missing: [
        { key: "next-router-prefetch", type: "header" },
        { key: "purpose", type: "header", value: "prefetch" },
      ],
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
