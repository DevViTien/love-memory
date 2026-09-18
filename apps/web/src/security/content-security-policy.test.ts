import { describe, expect, it } from "vitest";

import {
  createContentSecurityPolicy,
  getContentSecurityPolicyMode,
} from "./content-security-policy";

describe("content security policy", () => {
  it("keeps prerendered public pages compatible with Next.js scripts", () => {
    const policy = createContentSecurityPolicy({ isDevelopment: false, mode: "static" });

    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("strict-dynamic");
    expect(policy).not.toContain("nonce-");
  });

  it("uses a strict nonce policy for Studio", () => {
    const policy = createContentSecurityPolicy({
      assetOrigin: "https://cdn.example",
      isDevelopment: false,
      mode: "nonce",
      nonce: "request-nonce",
    });

    expect(policy).toContain("'nonce-request-nonce' 'strict-dynamic'");
    expect(policy).toContain(
      "connect-src 'self' blob: https://*.private.blob.vercel-storage.com https://cdn.example https://blob.vercel-storage.com https://vercel.com/api/blob/",
    );
    expect(policy).not.toContain("https://vercel.com ");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it("requires a nonce when strict mode is selected", () => {
    expect(() => createContentSecurityPolicy({ isDevelopment: false, mode: "nonce" })).toThrow(
      "requires a nonce",
    );
  });

  it("permits eval only for framework development tooling", () => {
    const policy = createContentSecurityPolicy({ isDevelopment: true, mode: "static" });

    expect(policy).toContain("'unsafe-eval'");
  });

  it("allows the isolated template document to be framed without network capabilities", () => {
    const policy = createContentSecurityPolicy({ isDevelopment: false, mode: "template" });

    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("https://*.private.blob.vercel-storage.com");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).not.toContain("strict-dynamic");
  });

  it.each([
    ["/", "static"],
    ["/templates/memory-box", "static"],
    ["/studio", "nonce"],
    ["/studio/new", "nonce"],
    ["/g/a-public-gift-slug", "nonce"],
    ["/template-spikes/memory-box", "template"],
    ["/template-artifacts/memory-box-spike/0.1.0", "template"],
    ["/viewer/memory-box-spike/0.1.0", "nonce"],
  ] as const)("selects %s as %s policy", (pathname, mode) => {
    expect(getContentSecurityPolicyMode(pathname)).toBe(mode);
  });
});
