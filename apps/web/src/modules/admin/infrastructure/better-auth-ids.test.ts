import { UUID } from "mongodb";
import { describe, expect, it } from "vitest";

import { authIdFilter, authIdString } from "./better-auth-ids";

const id = "8b869789-7d9f-474b-ba36-da954357c79d";

describe("Better Auth ids", () => {
  it("matches a UUID id in both stored forms, any other id as given", () => {
    expect(authIdFilter(id)).toEqual({ $in: [new UUID(id), id] });
    expect(authIdFilter("user-1")).toEqual({ $in: ["user-1"] });
  });

  it("gives the string form the application sees", () => {
    expect(authIdString(new UUID(id))).toBe(id);
    expect(authIdString("user-1")).toBe("user-1");
    expect(() => authIdString(42)).toThrow("Unexpected Better Auth id type.");
  });
});
