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
    ];
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
    "@love-memory/template-memory-box-spike",
    "@love-memory/ui",
  ],
  typedRoutes: true,
};

export default nextConfig;
