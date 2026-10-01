import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  createApiSuccessResponse,
  createInvalidBodyResponse,
  readJsonBody,
  validateJsonMutationRequest,
} from "./api-response";

describe("API response helpers", () => {
  it("parses and validates JSON bodies", async () => {
    await expect(
      readJsonBody(
        new Request("https://example.test", {
          body: JSON.stringify({ name: "An" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        z.object({ name: z.string().min(1) }),
      ),
    ).resolves.toEqual({ data: { name: "An" }, ok: true });
  });

  it("requires JSON and rejects cross-origin browser mutations", () => {
    expect(
      validateJsonMutationRequest(
        new Request("https://love.example.test/api/gifts", {
          body: "{}",
          headers: { "content-type": "text/plain" },
          method: "POST",
        }),
        "request-1",
      )?.status,
    ).toBe(415);
    expect(
      validateJsonMutationRequest(
        new Request("https://love.example.test/api/gifts", {
          body: "{}",
          headers: {
            "content-type": "application/json",
            origin: "https://attacker.example.test",
            "sec-fetch-site": "same-site",
          },
          method: "POST",
        }),
        "request-1",
      )?.status,
    ).toBe(403);
    expect(
      validateJsonMutationRequest(
        new Request("https://love.example.test/api/gifts", {
          body: "{}",
          headers: {
            "content-type": "application/json; charset=utf-8",
            origin: "https://love.example.test",
            "sec-fetch-site": "same-origin",
          },
          method: "POST",
        }),
        "request-1",
      ),
    ).toBeNull();
    expect(
      validateJsonMutationRequest(
        new Request("http://internal:3000/api/gifts", {
          body: "{}",
          headers: {
            "content-type": "application/json",
            host: "love.example.test",
            origin: "https://love.example.test",
            "sec-fetch-site": "same-origin",
            "x-forwarded-proto": "https",
          },
          method: "POST",
        }),
        "request-1",
      ),
    ).toBeNull();
    expect(
      validateJsonMutationRequest(
        new Request("http://internal:3000/api/gifts", {
          body: "{}",
          headers: {
            "content-type": "application/json",
            host: "internal:3000",
            origin: "https://love.example.test",
            "sec-fetch-site": "same-origin",
            "x-forwarded-host": "LOVE.EXAMPLE.TEST:443",
            "x-forwarded-proto": "https",
          },
          method: "POST",
        }),
        "request-1",
      ),
    ).toBeNull();
    expect(
      validateJsonMutationRequest(
        new Request("http://internal:3000/api/gifts", {
          body: "{}",
          headers: {
            "content-type": "application/json",
            origin: "https://love.example.test",
            "sec-fetch-site": "same-origin",
            "x-forwarded-host": "invalid host",
            "x-forwarded-proto": "https",
          },
          method: "POST",
        }),
        "request-1",
      )?.status,
    ).toBe(403);
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

  describe("body size cap", () => {
    const schema = z.object({ text: z.string() });

    function jsonOfBytes(bytes: number): string {
      // `{"text":"…"}` is 11 bytes around the padding.
      return JSON.stringify({ text: "a".repeat(bytes - 11) });
    }

    function streamOf(body: string): ReadableStream<Uint8Array> {
      const bytes = new TextEncoder().encode(body);
      return new ReadableStream({
        start(controller) {
          // Several chunks, and no `Content-Length`: the count must run while reading.
          for (let offset = 0; offset < bytes.length; offset += 500) {
            controller.enqueue(bytes.slice(offset, offset + 500));
          }
          controller.close();
        },
      });
    }

    it("refuses a declared Content-Length above the cap without reading", async () => {
      const request = new Request("https://example.test", {
        body: jsonOfBytes(100),
        headers: { "content-length": "4096" },
        method: "POST",
      });
      await expect(readJsonBody(request, schema, { maxBytes: 2048 })).resolves.toEqual({
        error: { kind: "too-large" },
        ok: false,
      });
      expect(request.bodyUsed).toBe(false);
    });

    it("refuses a 2049-byte chunked body and accepts exactly 2048 bytes", async () => {
      expect(jsonOfBytes(2049)).toHaveLength(2049);
      const tooLarge = new Request("https://example.test", {
        body: streamOf(jsonOfBytes(2049)),
        duplex: "half",
        method: "POST",
      } as RequestInit);
      await expect(readJsonBody(tooLarge, schema, { maxBytes: 2048 })).resolves.toEqual({
        error: { kind: "too-large" },
        ok: false,
      });

      const exact = new Request("https://example.test", {
        body: streamOf(jsonOfBytes(2048)),
        duplex: "half",
        method: "POST",
      } as RequestInit);
      const parsed = await readJsonBody(exact, schema, { maxBytes: 2048 });
      expect(parsed.ok).toBe(true);
    });

    it("reads multi-byte text and reports malformed JSON or an empty body as invalid JSON", async () => {
      const vietnamese = new Request("https://example.test", {
        body: JSON.stringify({ text: "Tiếng Việt 👩‍❤️‍👨" }),
        method: "POST",
      });
      await expect(readJsonBody(vietnamese, schema, { maxBytes: 2048 })).resolves.toEqual({
        data: { text: "Tiếng Việt 👩‍❤️‍👨" },
        ok: true,
      });
      await expect(
        readJsonBody(new Request("https://example.test", { body: "{", method: "POST" }), schema, {
          maxBytes: 2048,
        }),
      ).resolves.toEqual({ error: { kind: "invalid-json" }, ok: false });
      await expect(
        readJsonBody(new Request("https://example.test", { method: "POST" }), schema, {
          maxBytes: 2048,
        }),
      ).resolves.toEqual({ error: { kind: "invalid-json" }, ok: false });
    });

    it("keeps callers without the option unchanged", async () => {
      const large = new Request("https://example.test", {
        body: jsonOfBytes(5000),
        method: "POST",
      });
      const parsed = await readJsonBody(large, schema);
      expect(parsed.ok).toBe(true);
    });

    it("answers a too-large body with 413 VALIDATION_ERROR", async () => {
      const response = createInvalidBodyResponse({ kind: "too-large" }, "request-3");
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body is too large.",
          requestId: "request-3",
        },
      });
    });
  });
});
