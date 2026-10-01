import { PublicGiftResponseSchema } from "@love-memory/contracts";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const rateLimitMocks = vi.hoisted(() => ({ consume: vi.fn() }));

vi.mock("@/composition/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/modules/auth/infrastructure/auth-environment", () => ({
  getAuthEnvironment: () => ({ secret: "s".repeat(32) }),
}));

import { viewerPayload } from "@/modules/viewer/test/viewer-fixtures";

import {
  type PublicGiftService,
  type PublicViewerPayload,
} from "../application/public-gift-service";
import { handleGetPublicGift } from "./public-gift-route-handler";

const shareId = "Ab0_-cdefghijklmnopqrs";

function recipientViewer(): PublicViewerPayload {
  const { issues: _issues, ...viewer } = viewerPayload();
  return viewer;
}

function publicRequest(headers: Record<string, string> = {}): Request {
  return new Request(`https://love.example/api/public-gifts/${shareId}`, {
    headers: {
      "x-request-id": "request-1",
      "x-vercel-forwarded-for": "203.0.113.10",
      ...headers,
    },
  });
}

function params(value = shareId) {
  return { params: Promise.resolve({ shareId: value }) };
}

describe("public gift route handler", () => {
  let openPublicGift: ReturnType<typeof vi.fn<PublicGiftService["openPublicGift"]>>;
  let errorLog: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMocks.consume.mockResolvedValue({ allowed: true, retryAfterSeconds: 600 });
    openPublicGift = vi.fn<PublicGiftService["openPublicGift"]>(() =>
      Promise.resolve(recipientViewer()),
    );
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The forwarding header is trusted only on Vercel.
    vi.stubEnv("VERCEL", "1");
  });

  afterEach(() => {
    errorLog.mockRestore();
    vi.unstubAllEnvs();
  });

  const dependencies = () => ({
    consumeRateLimit: rateLimitMocks.consume,
    getService: () => ({ openPublicGift }),
  });

  it("answers 200 with the recipient payload and no-store", async () => {
    const response = await handleGetPublicGift(publicRequest(), params(), dependencies());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = PublicGiftResponseSchema.parse(await response.json());
    expect(body.data.viewer).toEqual(recipientViewer());
    expect(openPublicGift).toHaveBeenCalledWith(shareId);
  });

  it("charges the per-link counter, then the per-network counter", async () => {
    await handleGetPublicGift(publicRequest(), params(), dependencies());

    expect(rateLimitMocks.consume.mock.calls).toEqual([
      ["public-gift-read", `ip:203.0.113.10|share:${shareId}`],
      ["public-gift-read-ip", "ip:203.0.113.10"],
    ]);
  });

  it("answers 404 for a malformed id without charging the limit", async () => {
    const response = await handleGetPublicGift(publicRequest(), params("abc"), dependencies());

    expect(response.status).toBe(404);
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(openPublicGift).not.toHaveBeenCalled();
  });

  it("answers the same 404 for an unknown id, apart from the request id", async () => {
    openPublicGift.mockResolvedValue(null);
    const unknown = await handleGetPublicGift(
      publicRequest({ "x-request-id": "request-2" }),
      params(),
      dependencies(),
    );
    const malformed = await handleGetPublicGift(publicRequest(), params("abc"), dependencies());

    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("cache-control")).toBe("no-store");
    const unknownBody = (await unknown.json()) as { error: Record<string, unknown> };
    const malformedBody = (await malformed.json()) as { error: Record<string, unknown> };
    expect({ ...unknownBody.error, requestId: "x" }).toEqual({
      ...malformedBody.error,
      requestId: "x",
    });
    expect(unknownBody.error).toMatchObject({ code: "NOT_FOUND", message: "Gift was not found." });
  });

  it.each([
    ["the per-link counter", [{ allowed: false, retryAfterSeconds: 90 }]],
    [
      "the per-network counter",
      [
        { allowed: true, retryAfterSeconds: 600 },
        { allowed: false, retryAfterSeconds: 90 },
      ],
    ],
  ])("answers 429 with Retry-After from %s without calling the service", async (_name, results) => {
    for (const result of results) rateLimitMocks.consume.mockResolvedValueOnce(result);

    const response = await handleGetPublicGift(publicRequest(), params(), dependencies());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(rateLimitMocks.consume).toHaveBeenCalledTimes(results.length);
    expect(openPublicGift).not.toHaveBeenCalled();
  });

  it("answers 500 and logs only the operation, error class and request id (Unexpected failure)", async () => {
    openPublicGift.mockRejectedValue(new Error(`signing failed for ${shareId}`));

    const response = await handleGetPublicGift(publicRequest(), params(), dependencies());

    expect(response.status).toBe(500);
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("Operational request failed", {
      errorName: "Error",
      operation: "public_gift_read",
      requestId: "request-1",
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(shareId);
  });
});
