import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { InvalidObjectKeyError, parseObjectKey, resolveObjectPath } from "./local-object-key";

const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("object key validation", () => {
  it("accepts every key shape used by the pipeline", () => {
    for (const key of [
      `private/assets/${uuid}/source`,
      `private/assets/${uuid}/derivatives/w320.webp`,
      `private/assets/${uuid}/derivatives/w768.webp`,
      `private/assets/${uuid}/derivatives/w1280.webp`,
      `private/spikes/${uuid}/source`,
      `processed/spikes/${uuid}/w768.webp`,
      "a",
      "A_b-c.d",
    ]) {
      expect(parseObjectKey(key)).toBe(key);
    }
  });

  it("rejects traversal, separators and encoded input", () => {
    for (const key of [
      "..",
      ".",
      "private/../secret",
      "private/./source",
      "private//source",
      "/private/source",
      "private/source/",
      "",
      "private\\source",
      "C:/private",
      "private/a:b",
      "private/%2e%2e/secret",
      decodeURIComponent("private/%2e%2e/secret"),
      "private/.env",
      "private/source.",
      "private/so urce",
      "private/sóurce",
      "private/source\u0000",
    ]) {
      expect(parseObjectKey(key)).toBeNull();
    }
    expect(parseObjectKey(undefined)).toBeNull();
    expect(parseObjectKey(42)).toBeNull();
  });

  it("rejects Windows device names with or without an extension", () => {
    for (const segment of ["nul", "NUL", "con.txt", "Com1", "lpt9.webp", "aux", "prn.x.y"]) {
      expect(parseObjectKey(`private/${segment}`)).toBeNull();
    }
    expect(parseObjectKey("private/console")).toBe("private/console");
    expect(parseObjectKey("private/com10")).toBe("private/com10");
  });

  it("enforces segment count, segment length and total length", () => {
    expect(parseObjectKey(Array.from({ length: 16 }, () => "a").join("/"))).not.toBeNull();
    expect(parseObjectKey(Array.from({ length: 17 }, () => "a").join("/"))).toBeNull();
    expect(parseObjectKey("a".repeat(128))).not.toBeNull();
    expect(parseObjectKey("a".repeat(129))).toBeNull();
    const longest = Array.from({ length: 4 }, () => "a".repeat(127)).join("/");
    expect(longest).toHaveLength(511);
    expect(parseObjectKey(`${longest}b`)).not.toBeNull();
    expect(parseObjectKey(`${longest}/b`)).toBeNull();
  });
});

describe("object path resolution", () => {
  const directory = resolve("objects-root");

  it("keeps resolved paths inside the directory", () => {
    expect(resolveObjectPath(directory, `private/assets/${uuid}/source`, ".json")).toBe(
      join(directory, "private", "assets", uuid, "source.json"),
    );
  });

  it("throws before resolving an invalid key", () => {
    for (const key of ["../outside", "private/..", "a\\..\\b", "con"]) {
      expect(() => resolveObjectPath(directory, key)).toThrow(InvalidObjectKeyError);
    }
  });
});
