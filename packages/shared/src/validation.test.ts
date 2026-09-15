import { describe, expect, it } from "vitest";

import { SemanticVersionSchema, SlugSchema } from "./validation";

describe("shared validation schemas", () => {
  it.each(["1.0.0", "0.1.0-beta.1", "2.3.4+build.7"])("accepts SemVer %s", (version) => {
    expect(SemanticVersionSchema.parse(version)).toBe(version);
  });

  it.each(["01.0.0", "1.0", "latest", "1.0.0-"])("rejects invalid SemVer %s", (version) => {
    expect(SemanticVersionSchema.safeParse(version).success).toBe(false);
  });

  it("accepts kebab-case slugs only", () => {
    expect(SlugSchema.parse("memory-box")).toBe("memory-box");
    expect(SlugSchema.safeParse("Memory Box").success).toBe(false);
  });
});
