import { describe, expect, it } from "vitest";

import { parseMongoEnvironment } from "./environment";

describe("MongoDB environment", () => {
  it("parses a standard connection configuration", () => {
    expect(
      parseMongoEnvironment({
        MONGODB_DATABASE: "love_memory_test",
        MONGODB_URI: "mongodb://localhost:27017",
      }),
    ).toEqual({ databaseName: "love_memory_test", uri: "mongodb://localhost:27017" });
  });

  it("uses the default database name", () => {
    expect(parseMongoEnvironment({ MONGODB_URI: "mongodb+srv://cluster.example" })).toEqual({
      databaseName: "love_memory",
      uri: "mongodb+srv://cluster.example",
    });
  });

  it.each(["https://example.com", "mongodb-invalid"])("rejects invalid URI %s", (uri) => {
    expect(() => parseMongoEnvironment({ MONGODB_URI: uri })).toThrow();
  });

  it("rejects an unsafe database name", () => {
    expect(() =>
      parseMongoEnvironment({
        MONGODB_DATABASE: "love/memory",
        MONGODB_URI: "mongodb://localhost",
      }),
    ).toThrow();
  });
});
