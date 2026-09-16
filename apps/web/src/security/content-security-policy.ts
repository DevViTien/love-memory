export type ContentSecurityPolicyMode = "nonce" | "static" | "template";

export type ContentSecurityPolicyOptions = Readonly<{
  assetOrigin?: string;
  isDevelopment: boolean;
  mode: ContentSecurityPolicyMode;
  nonce?: string;
}>;

const VERCEL_BLOB_CONTROL_ORIGIN = "https://blob.vercel-storage.com";
const VERCEL_BLOB_OIDC_CONTROL_PATH = "https://vercel.com/api/blob/";
const VERCEL_PRIVATE_BLOB_ORIGIN = "https://*.private.blob.vercel-storage.com";

export function getContentSecurityPolicyMode(pathname: string): ContentSecurityPolicyMode {
  if (pathname === "/template-spikes" || pathname.startsWith("/template-spikes/")) {
    return "template";
  }

  return pathname === "/studio" || pathname.startsWith("/studio/") ? "nonce" : "static";
}

export function createContentSecurityPolicy({
  assetOrigin,
  isDevelopment,
  mode,
  nonce,
}: ContentSecurityPolicyOptions): string {
  if (mode === "nonce" && !nonce) {
    throw new Error("Nonce CSP mode requires a nonce.");
  }

  if (mode === "template") {
    return [
      "default-src 'none'",
      "base-uri 'none'",
      "connect-src 'none'",
      "font-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
      "img-src data:",
      "media-src 'none'",
      "object-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "worker-src 'none'",
    ].join("; ");
  }

  const assetSources = ["'self'", "blob:", VERCEL_PRIVATE_BLOB_ORIGIN, assetOrigin]
    .filter(Boolean)
    .join(" ");
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
