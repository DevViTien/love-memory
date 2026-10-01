import { describe, expect, it } from "vitest";

import { createGiftRefFactory } from "./gift-ref";

const secret = "k".repeat(32);
const giftId = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("gift reference HMAC", () => {
  it("pins a known vector of HMAC-SHA-256 over lm-gift-ref:v1:{giftId}", () => {
    expect(createGiftRefFactory(secret)(giftId)).toBe(
      "naEtyyn4RDw-NC1WyF0SJUmL2CCNPbZKJzedmL5JiXE",
    );
  });

  it("is 43 base64url characters and stable for one id", () => {
    const giftRef = createGiftRefFactory(secret);
    expect(giftRef(giftId)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(giftRef(giftId)).toBe(giftRef(giftId));
  });

  it("differs for different ids and different secrets", () => {
    const giftRef = createGiftRefFactory(secret);
    expect(giftRef("gift-2")).not.toBe(giftRef(giftId));
    expect(createGiftRefFactory("o".repeat(32))(giftId)).not.toBe(giftRef(giftId));
  });

  it("never equals or contains the input id", () => {
    for (const id of [giftId, "a", "gift-1", "AbCdEfGhIjKlMnOpQrStUv"]) {
      const value = createGiftRefFactory(secret)(id);
      expect(value).not.toBe(id);
      expect(value).not.toContain(id);
    }
  });
});
