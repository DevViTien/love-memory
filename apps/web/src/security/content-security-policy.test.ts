import { getLocalObjectStorageOrigin } from "@love-memory/storage";
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

  describe("local object storage origin", () => {
    const localEnvironment = {
      APP_URL: "http://127.0.0.1:3100",
      LOCAL_OBJECT_STORAGE_SECRET: "csp-local-object-storage-secret-0001",
      STORAGE_DRIVER: "local",
    };
    const directive = (policy: string, name: string) =>
      policy.split("; ").find((entry) => entry.startsWith(`${name} `));

    it("keeps policies without the option byte-for-byte unchanged", () => {
      expect(createContentSecurityPolicy({ isDevelopment: false, mode: "template" })).toBe(
        "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-ancestors 'self'; img-src data: https://*.private.blob.vercel-storage.com; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'unsafe-inline'; worker-src 'none'",
      );
      expect(
        createContentSecurityPolicy({
          assetOrigin: "https://cdn.example",
          isDevelopment: false,
          mode: "static",
        }),
      ).toBe(
        "default-src 'self'; base-uri 'self'; connect-src 'self' blob: https://*.private.blob.vercel-storage.com https://cdn.example https://blob.vercel-storage.com https://vercel.com/api/blob/; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: https://*.private.blob.vercel-storage.com https://cdn.example data:; media-src 'self' blob: https://*.private.blob.vercel-storage.com https://cdn.example; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
      );
    });

    it("lets templates show locally stored images (Template images in local storage mode)", () => {
      const policy = createContentSecurityPolicy({
        isDevelopment: false,
        localStorageOrigin: getLocalObjectStorageOrigin(localEnvironment),
        mode: "template",
      });
      expect(directive(policy, "img-src")).toBe(
        "img-src data: https://*.private.blob.vercel-storage.com http://127.0.0.1:3100/api/local-object-storage/",
      );
      expect(policy).toContain("connect-src 'none'");
    });

    it("adds no template origin for a refused local driver (Refused local driver adds no origin)", () => {
      const policy = createContentSecurityPolicy({
        assetOrigin: "https://cdn.example",
        isDevelopment: false,
        localStorageOrigin: getLocalObjectStorageOrigin({
          ...localEnvironment,
          VERCEL_ENV: "production",
        }),
        mode: "template",
      });
      expect(directive(policy, "img-src")).toBe(
        "img-src data: https://*.private.blob.vercel-storage.com https://cdn.example",
      );
    });

    it("allows uploads and images from the local origin (Local storage origin is allowed for uploads and images)", () => {
      const policy = createContentSecurityPolicy({
        isDevelopment: false,
        localStorageOrigin: getLocalObjectStorageOrigin({
          ...localEnvironment,
          APP_URL: "http://localhost:3000",
        }),
        mode: "nonce",
        nonce: "n",
      });
      expect(directive(policy, "connect-src")).toBe(
        "connect-src 'self' blob: https://*.private.blob.vercel-storage.com http://localhost:3000 https://blob.vercel-storage.com https://vercel.com/api/blob/",
      );
      expect(directive(policy, "img-src")).toContain("http://localhost:3000");
      expect(directive(policy, "media-src")).toContain("http://localhost:3000");
    });

    it("lists a local origin equal to the asset origin once", () => {
      const policy = createContentSecurityPolicy({
        assetOrigin: "http://localhost:3000",
        isDevelopment: false,
        localStorageOrigin: "http://localhost:3000",
        mode: "static",
      });
      expect(directive(policy, "img-src")!.split("http://localhost:3000")).toHaveLength(2);
    });

    it("adds no application origin for a refused local driver", () => {
      const policy = createContentSecurityPolicy({
        isDevelopment: false,
        localStorageOrigin: getLocalObjectStorageOrigin({
          ...localEnvironment,
          VERCEL_ENV: "preview",
        }),
        mode: "static",
      });
      expect(directive(policy, "img-src")).toBe(
        "img-src 'self' blob: https://*.private.blob.vercel-storage.com data:",
      );
    });
  });

  it.each([
    ["/", "static"],
    ["/templates/memory-box", "static"],
    ["/studio", "nonce"],
    ["/studio/new", "nonce"],
    ["/g/a-public-gift-slug", "nonce"],
    [`/g/${"A".repeat(22)}`, "nonce"],
    ["/gifts", "static"],
    ["/template-spikes/memory-box", "template"],
    ["/template-artifacts/memory-box-spike/0.1.0", "template"],
    ["/viewer/memory-box-spike/0.1.0", "nonce"],
    ["/preview", "nonce"],
    [`/preview/${"a".repeat(43)}`, "nonce"],
    ["/preview/abc", "nonce"],
    ["/previews", "static"],
    ["/preview-guide", "static"],
  ] as const)("selects %s as %s policy", (pathname, mode) => {
    expect(getContentSecurityPolicyMode(pathname)).toBe(mode);
  });
});
