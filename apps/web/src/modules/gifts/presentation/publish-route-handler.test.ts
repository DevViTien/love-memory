import { GiftPublicationResponseSchema } from "@love-memory/contracts";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const rateLimitMocks = vi.hoisted(() => ({ consume: vi.fn() }));

vi.mock("@/composition/session", () => ({ getCurrentUser: sessionMocks.getCurrentUser }));
vi.mock("@/modules/auth/infrastructure/auth-environment", () => ({
  getAuthEnvironment: () => ({ secret: "s".repeat(32) }),
}));
vi.mock("@/modules/gifts/infrastructure/mongo-gift-rate-limiter", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeApiRateLimit: rateLimitMocks.consume,
}));

import { type GiftPublicationDto, type GiftServiceResult } from "../application/gift-service";
import { handlePublishGift } from "./publish-route-handler";

const publicId = "q1w2e3r4t5y6u7i8";
const key = "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e";
const shareId = "Ab0_-cdefghijklmnopqrs";
const publication: GiftPublicationDto = {
  publicId,
  publishedAt: "2026-10-01T08:00:00.000Z",
  revision: 7,
  shareId,
  sharePath: `/g/${shareId}`,
  status: "published",
};

type PublishFn = (
  input: Readonly<{
    expectedRevision: number;
    idempotencyKey: string;
    publicId: string;
    requestId?: string;
    userId: string | null;
  }>,
) => Promise<GiftServiceResult<GiftPublicationDto>>;

function publishRequest(
  init: Readonly<{
    body?: string;
    contentType?: string;
    idempotencyKey?: string | null;
    origin?: string;
  }> = {},
): Request {
  const idempotencyKey = init.idempotencyKey === undefined ? key : init.idempotencyKey;
  return new Request(`https://love.example/api/gifts/${publicId}/publish`, {
    body: init.body ?? JSON.stringify({ expectedRevision: 7 }),
    headers: {
      "content-type": init.contentType ?? "application/json",
      "x-request-id": "request-1",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
    },
    method: "POST",
  });
}

function params(value = publicId) {
  return { params: Promise.resolve({ publicId: value }) };
}

async function errorBody(response: Response) {
  return (
    (await response.json()) as {
      error: {
        code: string;
        details?: Record<string, unknown>;
        fieldErrors?: Record<string, string>;
        message: string;
      };
    }
  ).error;
}

describe("publish route handler", () => {
  let publishGift: ReturnType<typeof vi.fn<PublishFn>>;
  let errorLog: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    rateLimitMocks.consume.mockResolvedValue({ allowed: true, retryAfterSeconds: 600 });
    publishGift = vi.fn<PublishFn>(() => Promise.resolve({ data: publication, ok: true }));
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  const dependencies = () => ({ getService: () => ({ publishGift }) });

  it("answers 201 with the publication for the owner", async () => {
    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(GiftPublicationResponseSchema.parse(await response.json())).toEqual({
      data: { publication },
    });
    expect(publishGift).toHaveBeenCalledWith({
      expectedRevision: 7,
      idempotencyKey: key,
      publicId,
      requestId: "request-1",
      userId: "user-1",
    });
    expect(rateLimitMocks.consume).toHaveBeenCalledWith(
      "gift-publish",
      "user:user-1",
      "s".repeat(32),
    );
  });

  it("answers 400 for a missing or malformed Idempotency-Key", async () => {
    for (const idempotencyKey of [null, "not-a-uuid"]) {
      const response = await handlePublishGift(
        publishRequest({ idempotencyKey }),
        params(),
        dependencies(),
      );
      expect(response.status).toBe(400);
      expect((await errorBody(response)).fieldErrors).toHaveProperty("idempotencyKey");
    }
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(publishGift).not.toHaveBeenCalled();
  });

  it("answers 400 for an unexpected body key", async () => {
    const response = await handlePublishGift(
      publishRequest({ body: JSON.stringify({ expectedRevision: 3, shareId: "abc" }) }),
      params(),
      dependencies(),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).code).toBe("VALIDATION_ERROR");
    expect(publishGift).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    sessionMocks.getCurrentUser.mockResolvedValue(null);
    publishGift.mockResolvedValue({ error: { code: "NOT_AUTHENTICATED" }, ok: false });

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(401);
    expect((await errorBody(response)).code).toBe("UNAUTHORIZED");
    expect(publishGift).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it("answers 403 when publishing is not enabled", async () => {
    publishGift.mockResolvedValue({ error: { code: "FORBIDDEN" }, ok: false });

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(403);
    expect(await errorBody(response)).toMatchObject({
      code: "FORBIDDEN",
      message: "Publishing is not enabled for this account.",
    });
  });

  it("answers the same opaque 404 for a malformed id and for a non-owner", async () => {
    const malformed = await handlePublishGift(publishRequest(), params("bad id"), dependencies());
    publishGift.mockResolvedValue({ error: { code: "NOT_FOUND" }, ok: false });
    const nonOwner = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(malformed.status).toBe(404);
    expect(nonOwner.status).toBe(404);
    expect(await errorBody(malformed)).toEqual(await errorBody(nonOwner));
    expect(rateLimitMocks.consume).toHaveBeenCalledTimes(1);
  });

  it("answers 409 without details for a gift that is not a draft", async () => {
    publishGift.mockResolvedValue({ error: { code: "INVALID_STATE" }, ok: false });

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(409);
    const error = await errorBody(response);
    expect(error.code).toBe("CONFLICT");
    expect(error.details).toBeUndefined();
  });

  it("answers 409 with the actual revision for a stale revision", async () => {
    publishGift.mockResolvedValue({
      error: { actualRevision: 8, code: "REVISION_CONFLICT", expectedRevision: 7 },
      ok: false,
    });

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(409);
    expect((await errorBody(response)).details).toEqual({ actualRevision: 8, expectedRevision: 7 });
  });

  it.each([
    ["ACCESS_POLICY_UNSUPPORTED", "ACCESS_POLICY_UNSUPPORTED"],
    ["TEMPLATE_NOT_EDITABLE", "TEMPLATE_VERSION_NOT_EDITABLE"],
    ["TEMPLATE_UNPUBLISHABLE", "TEMPLATE_VERSION_UNPUBLISHABLE"],
  ] as const)("answers 409 with details.reason for %s", async (code, reason) => {
    publishGift.mockResolvedValue({ error: { code }, ok: false });

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(409);
    expect((await errorBody(response)).details).toEqual({ reason });
  });

  it("answers 400 with field errors for content issues", async () => {
    publishGift.mockResolvedValue({
      error: { code: "INVALID_CONTENT", fieldErrors: { "memories.2": "This image is not ready." } },
      ok: false,
    });

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(400);
    expect((await errorBody(response)).fieldErrors).toEqual({
      "memories.2": "This image is not ready.",
    });
  });

  it("answers 415 for text/plain", async () => {
    const response = await handlePublishGift(
      publishRequest({ contentType: "text/plain" }),
      params(),
      dependencies(),
    );

    expect(response.status).toBe(415);
    expect(publishGift).not.toHaveBeenCalled();
  });

  it("answers 403 for a cross-site origin without charging the rate limit", async () => {
    const response = await handlePublishGift(
      publishRequest({ origin: "https://attacker.example.test" }),
      params(),
      dependencies(),
    );

    expect(response.status).toBe(403);
    expect((await errorBody(response)).code).toBe("FORBIDDEN");
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
    expect(publishGift).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After once the gift-publish limit is reached", async () => {
    rateLimitMocks.consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect((await errorBody(response)).details).toEqual({ retryAfterSeconds: 120 });
    expect(publishGift).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 KiB unread (Oversized publish body)", async () => {
    const response = await handlePublishGift(
      publishRequest({ body: JSON.stringify({ expectedRevision: 7, pad: "x".repeat(2048) }) }),
      params(),
      dependencies(),
    );

    expect(response.status).toBe(413);
    expect((await errorBody(response)).code).toBe("VALIDATION_ERROR");
    expect(publishGift).not.toHaveBeenCalled();
  });

  it("answers 500 and logs only the operation, error class and request id", async () => {
    publishGift.mockRejectedValue(new Error(`write failed for ${publicId} ${shareId}`));

    const response = await handlePublishGift(publishRequest(), params(), dependencies());

    expect(response.status).toBe(500);
    expect((await errorBody(response)).code).toBe("INTERNAL_ERROR");
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("Operational request failed", {
      errorName: "Error",
      operation: "gift_publish",
      requestId: "request-1",
    });
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain(publicId);
    expect(logged).not.toContain(shareId);
  });
});
