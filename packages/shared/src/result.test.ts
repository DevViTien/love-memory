import { describe, expect, it } from "vitest";

import { failure, success, unwrap } from "./result";

describe("Result", () => {
  it("returns data from a successful result", () => {
    expect(unwrap(success("memory"))).toBe("memory");
  });

  it("throws when a failed result is unwrapped", () => {
    expect(() => unwrap(failure({ code: "FAILED" }))).toThrow("Cannot unwrap a failed result.");
  });
});
