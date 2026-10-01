import { GiftPreviewLinkResponseSchema } from "@love-memory/contracts";
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

import { type PreviewService } from "../application/preview-service";
import { handleCreateGiftPreview } from "./preview-route-handler";

const publicId = "q1w2e3r4t5y6u7i8";
const token = "A-_b".repeat(10) + "xyz";
const link = { expiresAt: "2026-10-01T10:30:00.000Z", url: `/preview/${token}` };

function previewRequest(
  init: Readonly<{ body?: string; contentType?: string; origin?: string }> = {},
): Request {
  return new Request(`https://love.example/api/gifts/${publicId}/preview`, {
    body: init.body ?? "{}",
    headers: {
      "content-type": init.contentType ?? "application/json",
      "x-request-id": "request-1",
      ...(init.origin ? { origin: init.origin } : {}),
    },
    method: "POST",
  });
}

function params(value = publicId) {
  return { params: Promise.resolve({ publicId: value }) };
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("preview route handler", () => {
  let createPreviewLink: ReturnType<typeof vi.fn<PreviewService["createPreviewLink"]>>;
  let service: PreviewService;
  let errorLog: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    rateLimitMocks.consume.mockResolvedValue({ allowed: true, retryAfterSeconds: 600 });
    createPreviewLink = vi.fn<PreviewService["createPreviewLink"]>(() =>
      Promise.resolve({ data: link, ok: true }),
    );
    service = {
      canEditDraft: vi.fn(),
      createPreviewLink,
      openPreview: vi.fn(),
    };
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  const dependencies = () => ({ getService: () => service });

  it("answers 201 with a valid link for the owner", async () => {
    const response = await handleCreateGiftPreview(previewRequest(), params(), dependencies());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(GiftPreviewLinkResponseSchema.parse(await response.json())).toEqual({ data: link });
    expect(createPreviewLink).toHaveBeenCalledWith({
      accessors: [{ kind: "user", userId: "user-1" }],
      publicId,
    });
    expect(rateLimitMocks.consume).toHaveBeenCalledWith(
      "gift-preview",
      "user:user-1",
      "s".repeat(32),
    );
  });

  it("answers an opaque 404 for a malformed id", async () => {
    const response = await handleCreateGiftPreview(
      previewRequest(),
      params("bad id"),
      dependencies(),
    );

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
  });

  it("answers an opaque 404 without credentials, before the service", async () => {
    sessionMocks.getCurrentUser.mockResolvedValue(null);

    const response = await handleCreateGiftPreview(previewRequest(), params(), dependencies());

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "Gift draft was not found.",
    );
    expect(createPreviewLink).not.toHaveBeenCalled();
  });

  it("answers 404 for a non-owner or a gift that is not a draft", async () => {
    createPreviewLink.mockResolvedValue({ error: { code: "NOT_FOUND" }, ok: false });

    const response = await handleCreateGiftPreview(previewRequest(), params(), dependencies());

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("NOT_FOUND");
  });

  it("answers 409 CONFLICT for an unresolved template version", async () => {
    createPreviewLink.mockResolvedValue({ error: { code: "INVALID_STATE" }, ok: false });

    const response = await handleCreateGiftPreview(previewRequest(), params(), dependencies());

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("CONFLICT");
  });

  it("answers 415 for text/plain and 400 for unexpected body keys", async () => {
    const plain = await handleCreateGiftPreview(
      previewRequest({ contentType: "text/plain" }),
      params(),
      dependencies(),
    );
    const extra = await handleCreateGiftPreview(
      previewRequest({ body: JSON.stringify({ ttl: 99999 }) }),
      params(),
      dependencies(),
    );

    expect(plain.status).toBe(415);
    expect(await errorCode(plain)).toBe("VALIDATION_ERROR");
    expect(extra.status).toBe(400);
    expect(await errorCode(extra)).toBe("VALIDATION_ERROR");
    expect(createPreviewLink).not.toHaveBeenCalled();
  });

  it("answers 403 for a cross-site origin without charging the rate limit", async () => {
    const response = await handleCreateGiftPreview(
      previewRequest({ origin: "https://attacker.example.test" }),
      params(),
      dependencies(),
    );

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("FORBIDDEN");
    expect(rateLimitMocks.consume).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After once the gift-preview limit is reached", async () => {
    rateLimitMocks.consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });

    const response = await handleCreateGiftPreview(previewRequest(), params(), dependencies());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    const body = (await response.json()) as {
      error: { code: string; details: { retryAfterSeconds: number } };
    };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retryAfterSeconds).toBe(120);
    expect(createPreviewLink).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 KiB unread", async () => {
    const response = await handleCreateGiftPreview(
      previewRequest({ body: JSON.stringify({ pad: "x".repeat(2048) }) }),
      params(),
      dependencies(),
    );

    expect(response.status).toBe(413);
    expect(createPreviewLink).not.toHaveBeenCalled();
  });

  it("answers 500 and logs only the operation, error class and request id", async () => {
    createPreviewLink.mockRejectedValue(new Error(`insert failed for ${token} ${publicId}`));

    const response = await handleCreateGiftPreview(previewRequest(), params(), dependencies());

    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("INTERNAL_ERROR");
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("Operational request failed", {
      errorName: "Error",
      operation: "gift_preview_create",
      requestId: "request-1",
    });
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(publicId);
  });
});
