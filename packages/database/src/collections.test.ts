import { describe, expect, it } from "vitest";

import { COLLECTIONS } from "./collections";

describe("MongoDB collection registry", () => {
  it("uses unique, stable names", () => {
    const names = Object.values(COLLECTIONS);

    expect(COLLECTIONS.gifts).toBe("gifts");
    expect(COLLECTIONS.templateVersions).toBe("templateVersions");
    expect(new Set(names).size).toBe(names.length);
  });
});
