import { z } from "zod";

// SemVer 2.0.0 without surrounding whitespace. Numeric identifiers reject leading zeroes.
export const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const SemanticVersionSchema = z.string().regex(SEMANTIC_VERSION_PATTERN, {
  message: "Expected a valid semantic version.",
});

export const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Expected a lowercase kebab-case identifier.",
  });
