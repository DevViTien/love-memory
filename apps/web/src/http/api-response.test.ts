import { z } from "zod";
import { describe, expect, it } from "vitest";

import { createApiSuccessResponse, createInvalidBodyResponse, readJsonBody } from "./api-response";

describe("API response helpers", () => {
  it("parses and validates JSON bodies", async () => {
    await expect(
      readJsonBody(
        new Request("https://example.test", {
          body: JSON.stringify({ name: "An" }),
          method: "POST",
        }),
        z.object({ name: z.string().min(1) }),
      ),
    ).resolves.toEqual({ data: { name: "An" }, ok: true });
  });

  it("normalizes malformed and invalid bodies", async () => {
    const malformed = await readJsonBody(
      new Request("https://example.test", { body: "{", method: "POST" }),
      z.object({ name: z.string() }),
    );
    const invalid = await readJsonBody(
      new Request("https://example.test", { body: JSON.stringify({ name: 1 }), method: "POST" }),
      z.object({ name: z.string() }),
    );

    expect(malformed).toEqual({ error: { kind: "invalid-json" }, ok: false });
    expect(invalid.ok).toBe(false);
  });

  it("sets no-store and request identifiers on envelopes", async () => {
    const response = createApiSuccessResponse({ status: "ok" }, "request-1", 201);
    const errorResponse = createInvalidBodyResponse(
      { fieldErrors: { name: "Required" }, kind: "validation" },
      "request-2",
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { status: "ok" } });
    expect(errorResponse.status).toBe(400);
    expect(errorResponse.headers.get("x-request-id")).toBe("request-2");
  });
});
