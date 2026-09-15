import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      exclude: ["**/*.config.*", "**/*.d.ts", "**/index.ts", "**/test/**", "**/types.ts"],
      include: [
        "packages/{contracts,database,domain,media,shared,storage,template-sdk}/src/**/*.ts",
        "packages/ui/src/**/*.{ts,tsx}",
        "apps/web/src/{config,http,observability,security}/**/*.ts",
        "apps/web/src/modules/**/{application,infrastructure}/**/*.ts",
        "apps/web/src/modules/**/presentation/**/*.ts",
      ],
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        perFile: {
          branches: 50,
          functions: 60,
          lines: 60,
          statements: 60,
        },
        statements: 80,
      },
    },
    projects: [
      {
        test: {
          environment: "node",
          include: [
            "packages/{contracts,database,domain,media,shared,storage,template-sdk}/src/**/*.test.ts",
            "test/**/*.test.ts",
          ],
          name: "domain",
        },
      },
      {
        test: {
          environment: "jsdom",
          include: ["packages/ui/src/**/*.test.tsx", "apps/web/src/**/*.test.{ts,tsx}"],
          name: "web",
          setupFiles: ["./test/setup-dom.ts"],
        },
      },
    ],
  },
});
