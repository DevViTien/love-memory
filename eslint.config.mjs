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
  ]),
]);
