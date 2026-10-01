import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        headers: [
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
        source: "/:path*",
      },
      {
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
        source: "/template-spikes/:path*",
      },
      {
        // Artifacts are framed by the Viewer; this matches their `frame-ancestors 'self'` CSP.
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
        source: "/template-artifacts/:path*",
      },
      {
        // Licensed audio files carry their content hash in the file name and never change.
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
        source: "/audio-library/:path*",
      },
      {
        // Preview links are bearer capabilities for private draft content. Listed after the global
        // entry so its `Referrer-Policy` wins: the token must never leave in a `Referer` header.
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
          // The page embeds draft text and signed asset URLs: no browser or shared cache keeps it.
          { key: "Cache-Control", value: "private, no-store" },
        ],
        source: "/preview/:path*",
      },
      {
        // Share links are bearer credentials for a published gift. Listed after the global entry
        // so `no-referrer` wins: the share id must never leave in a `Referer` header, and no
        // browser or shared cache keeps the page.
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
        source: "/g/:path*",
      },
    ];
  },
  logging: {
    // Development-only request log: signed local object URLs, preview tokens and share ids must
    // never be printed.
    incomingRequests: {
      ignore: [/\/api\/local-object-storage\//, /^\/preview\//, /^\/g\//, /^\/api\/public-gifts\//],
    },
  },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@love-memory/contracts",
    "@love-memory/database",
    "@love-memory/domain",
    "@love-memory/media",
    "@love-memory/shared",
    "@love-memory/storage",
    "@love-memory/template-sdk",
    "@love-memory/template-memory-box",
    "@love-memory/template-memory-box-spike",
    "@love-memory/ui",
  ],
  typedRoutes: true,
};

export default nextConfig;
