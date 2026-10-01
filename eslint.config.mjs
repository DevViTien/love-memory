import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const typeCheckedFiles = [
  "apps/*/src/**/*.{ts,tsx}",
  "apps/*/e2e/**/*.ts",
  "packages/*/src/**/*.{ts,tsx}",
  "test/**/*.ts",
];

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typeCheckedFiles,
  })),
  {
    files: typeCheckedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@next/next/no-html-link-for-pages": "off",
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["packages/domain/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react/*", "mongodb", "@/*"],
              message: "Domain code must remain framework and provider independent.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/*/src/modules/*/application/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../infrastructure/*",
                "../../infrastructure/*",
                "@/modules/*/infrastructure/*",
              ],
              message:
                "Application services depend on ports; wire infrastructure in a composition root.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/*/src/modules/*/presentation/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/test/**",
      // Known exceptions, moved behind composition in Sprint 4 (docs/sprints/sprint-3-review.md,
      // A19): the generic rate limiter still lives in gifts/infrastructure. Do not add entries.
      "apps/web/src/modules/gifts/presentation/gift-route-helpers.ts",
      "apps/web/src/modules/public-gifts/presentation/public-gift-route-handler.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../infrastructure/*",
                "../../infrastructure/*",
                "@/modules/*/infrastructure/*",
              ],
              message:
                "Presentation code depends on application services and ports; wire infrastructure in apps/web/src/composition.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/next-env.d.ts",
    // Committed template releases are immutable bytes; tools never rewrite them.
    "templates/*/releases/**",
    // Claude Code subagent worktrees are separate checkouts with their own tooling runs.
    ".claude/worktrees/**",
  ]),
]);
