import { describe, expect, it } from "vitest";

import { MongoSpikeResponseSchema } from "./technical-spike";

describe("technical spike contracts", () => {
  it("accepts only a fully verified MongoDB probe", () => {
    expect(
      MongoSpikeResponseSchema.safeParse({
        data: { connectionReused: true, readVerified: true, writeVerified: true },
      }).success,
    ).toBe(true);
    expect(
      MongoSpikeResponseSchema.safeParse({
        data: { connectionReused: true, readVerified: false, writeVerified: true },
      }).success,
    ).toBe(false);
  });
});
