import { LOCAL_OBJECT_ROUTE_PATH } from "@love-memory/storage";

export type ContentSecurityPolicyMode = "nonce" | "static" | "template";

export type ContentSecurityPolicyOptions = Readonly<{
  assetOrigin?: string;
  isDevelopment: boolean;
  /** The local object storage origin; set only while the `local` storage driver is active. */
  localStorageOrigin?: string | undefined;
  mode: ContentSecurityPolicyMode;
  nonce?: string;
  /**
   * Template mode: adds `sandbox allow-scripts`, so a template artifact runs in an opaque origin
   * even when it is opened as a top-level page (`/template-artifacts/...`).
   */
  sandbox?: boolean;
  /**
   * Template mode: the request origin; fonts and images may come from its `/template-artifacts/`
   * path (an html template's own files). Without it, fonts are denied.
   */
  templateOrigin?: string | undefined;
}>;

/** The path of every template artifact file. */
export const TEMPLATE_ARTIFACTS_PATH = "/template-artifacts/";

/**
 * The origin that serves template artifact files: the configured `APP_URL`, or the request's own
 * origin when none is configured (the `Host` the browser used, not the server's bind address, when
 * it is a well-formed host).
 */
export function templateArtifactOrigin(
  appUrl: URL | undefined,
  request: Readonly<{ headers: Headers; url: string }>,
): string {
  if (appUrl) return appUrl.origin;
  const url = new URL(request.url);
  const host = request.headers.get("host");
  // Only a plain host name, IPv4 or bracketed IPv6 literal with an optional port: a `Host` header
  // with spaces, `;` or other policy syntax must never reach the CSP.
  if (!host || !SAFE_HOST.test(host) || !/[A-Za-z0-9]/.test(host)) return url.origin;
  try {
    // The regex admits values no URL parser accepts (`a:99999`, `[:]`): fall back, never throw.
    return new URL(`${url.protocol}//${host}`).origin;
  } catch {
    return url.origin;
  }
}

const SAFE_HOST = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/** Whether a path is a content-addressed template artifact (sandboxed template CSP). */
export function isTemplateArtifactPath(pathname: string): boolean {
  return pathname.startsWith(TEMPLATE_ARTIFACTS_PATH);
}

const VERCEL_BLOB_CONTROL_ORIGIN = "https://blob.vercel-storage.com";
const VERCEL_BLOB_OIDC_CONTROL_PATH = "https://vercel.com/api/blob/";
const VERCEL_PRIVATE_BLOB_ORIGIN = "https://*.private.blob.vercel-storage.com";

export function getContentSecurityPolicyMode(pathname: string): ContentSecurityPolicyMode {
  if (
    pathname === "/template-spikes" ||
    pathname.startsWith("/template-spikes/") ||
    pathname.startsWith("/template-artifacts/")
  ) {
    return "template";
  }

  return pathname === "/studio" ||
    pathname.startsWith("/studio/") ||
    pathname.startsWith("/viewer/") ||
    pathname === "/preview" ||
    pathname.startsWith("/preview/") ||
    pathname === "/g" ||
    pathname.startsWith("/g/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/checkout" ||
    pathname.startsWith("/checkout/") ||
    pathname.startsWith("/billing/")
    ? "nonce"
    : "static";
}

function uniqueSources(sources: ReadonlyArray<string | undefined>): string {
  return [...new Set(sources.filter((source): source is string => Boolean(source)))].join(" ");
}

export function createContentSecurityPolicy({
  assetOrigin,
  isDevelopment,
  localStorageOrigin,
  mode,
  nonce,
  sandbox = false,
  templateOrigin,
}: ContentSecurityPolicyOptions): string {
  if (mode === "nonce" && !nonce) {
    throw new Error("Nonce CSP mode requires a nonce.");
  }

  if (mode === "template") {
    // Templates may load only signed local object URLs, not every route of the application origin.
    const localObjectSource = localStorageOrigin
      ? `${localStorageOrigin}${LOCAL_OBJECT_ROUTE_PATH}`
      : undefined;
    // An html template's own bundled fonts and images, never another route of the application.
    const artifactSource = templateOrigin
      ? `${new URL(templateOrigin).origin}${TEMPLATE_ARTIFACTS_PATH}`
      : undefined;
    return [
      "default-src 'none'",
      "base-uri 'none'",
      "connect-src 'none'",
      `font-src ${artifactSource ?? "'none'"}`,
      "form-action 'none'",
      "frame-ancestors 'self'",
      `img-src ${uniqueSources(["data:", artifactSource, VERCEL_PRIVATE_BLOB_ORIGIN, assetOrigin, localObjectSource])}`,
      "media-src 'none'",
      "object-src 'none'",
      ...(sandbox ? ["sandbox allow-scripts"] : []),
      "script-src 'self'",
      "style-src 'unsafe-inline'",
      "worker-src 'none'",
    ].join("; ");
  }

  const assetSources = uniqueSources([
    "'self'",
    "blob:",
    VERCEL_PRIVATE_BLOB_ORIGIN,
    assetOrigin,
    localStorageOrigin,
  ]);
  const connectSources = [
    assetSources,
    VERCEL_BLOB_CONTROL_ORIGIN,
    VERCEL_BLOB_OIDC_CONTROL_PATH,
  ].join(" ");
  const imageSources = [assetSources, "data:"].join(" ");
  const scriptSources =
    mode === "nonce"
      ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
      : ["'self'", "'unsafe-inline'"];
  const styleSources =
    mode === "nonce" && !isDevelopment
      ? ["'self'", `'nonce-${nonce}'`]
      : ["'self'", "'unsafe-inline'"];

  if (isDevelopment) {
    scriptSources.push("'unsafe-eval'");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `img-src ${imageSources}`,
    `media-src ${assetSources}`,
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    "worker-src 'self' blob:",
  ].join("; ");
}
