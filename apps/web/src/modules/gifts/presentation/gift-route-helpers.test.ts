import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  createAnonymousDraftIdentity,
  serializeAnonymousDraftCookie,
} from "../infrastructure/anonymous-draft-identity";
import {
  enforceGiftMutationRateLimit,
  getGiftRequestContext,
  giftDraftResponse,
  giftServiceErrorResponse,
  requestId,
} from "./gift-route-helpers";

describe("gift route helpers", () => {
  beforeEach(() => {
    sessionMocks.getCurrentUser.mockReset();
    rateLimitMocks.consume.mockReset();
    sessionMocks.getCurrentUser.mockResolvedValue(null);
    // The forwarding header is trusted only on Vercel.
    vi.stubEnv("VERCEL", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds anonymous and authenticated accessors from server-controlled credentials", async () => {
    const identity = createAnonymousDraftIdentity();
    const cookie = serializeAnonymousDraftCookie(identity).split(";")[0] ?? "";
    const anonymous = await getGiftRequestContext(
      new Request("https://example.com/api/gifts", { headers: { cookie } }),
    );

    expect(anonymous.accessors).toContainEqual(
      expect.objectContaining({
        anonymousDraftId: identity.anonymousDraftId,
        kind: "anonymous",
      }),
    );

    sessionMocks.getCurrentUser.mockResolvedValue({
      email: "admin@example.com",
      id: "admin-1",
      name: "Admin",
      role: "admin",
    });
    const authenticated = await getGiftRequestContext(new Request("https://example.com/api/gifts"));
    expect(authenticated.accessors).toEqual([{ kind: "user", userId: "admin-1" }]);
  });

  it("keeps both account and anonymous credentials after sign-in", async () => {
    const identity = createAnonymousDraftIdentity();
    const cookie = serializeAnonymousDraftCookie(identity).split(";")[0] ?? "";
    sessionMocks.getCurrentUser.mockResolvedValue({
      email: "creator@example.com",
      id: "creator-1",
      name: "",
      role: "creator",
    });

    const context = await getGiftRequestContext(
      new Request("https://example.com/api/gifts", { headers: { cookie } }),
    );

    expect(context.accessors.map((accessor) => accessor.kind)).toEqual(["user", "anonymous"]);
  });

  it("preserves bounded request ids and creates one for untrusted values", () => {
    expect(
      requestId(new Request("https://example.com", { headers: { "x-request-id": "trace-1" } })),
    ).toBe("trace-1");
    expect(
      requestId(
        new Request("https://example.com", { headers: { "x-request-id": "x".repeat(129) } }),
      ),
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    [{ code: "NOT_FOUND" } as const, 404],
    [{ code: "NOT_AUTHENTICATED" } as const, 401],
    [{ code: "INVALID_STATE" } as const, 409],
    [{ code: "IDEMPOTENCY_CONFLICT" } as const, 409],
    [{ code: "INVALID_CONTENT", fieldErrors: { headline: "Too long" } } as const, 400],
    [{ actualRevision: 2, code: "REVISION_CONFLICT", expectedRevision: 1 } as const, 409],
  ])("maps %j to an API response", async (error, status) => {
    const response = giftServiceErrorResponse(error, "request-1");

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toHaveProperty("error.requestId", "request-1");
  });

  it("refuses edits to a non-editable template version with 409 CONFLICT", async () => {
    const response = giftServiceErrorResponse({ code: "INVALID_STATE" }, "request-1");

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details).toBeUndefined();
  });

  it("tells a revision conflict apart by details.actualRevision", async () => {
    const response = giftServiceErrorResponse(
      { actualRevision: 2, code: "REVISION_CONFLICT", expectedRevision: 1 },
      "request-1",
    );

    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CONFLICT", details: { actualRevision: 2, expectedRevision: 1 } },
    });
  });

  it("maps the publish refusals to 403 and to 409 with a reason", async () => {
    const forbidden = giftServiceErrorResponse({ code: "FORBIDDEN" }, "request-1");
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN", message: "Publishing is not enabled for this account." },
    });

    for (const [code, reason] of [
      ["ACCESS_POLICY_UNSUPPORTED", "ACCESS_POLICY_UNSUPPORTED"],
      ["TEMPLATE_NOT_EDITABLE", "TEMPLATE_VERSION_NOT_EDITABLE"],
      ["TEMPLATE_UNPUBLISHABLE", "TEMPLATE_VERSION_UNPUBLISHABLE"],
    ] as const) {
      const response = giftServiceErrorResponse({ code }, "request-1");
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "CONFLICT", details: { reason } },
      });
    }
  });

  it("wraps draft DTOs in the common success envelope", async () => {
    const response = giftDraftResponse({ publicId: "gift-1" }, "request-1", 201);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { gift: { publicId: "gift-1" } } });
  });

  it("charges anonymous requests to the network guard and rejects when it is exhausted", async () => {
    const identity = createAnonymousDraftIdentity();
    const cookie = serializeAnonymousDraftCookie(identity).split(";")[0] ?? "";
    const request = new Request("https://example.com/api/gifts", {
      headers: { cookie, "x-vercel-forwarded-for": "203.0.113.10" },
    });
    const context = await getGiftRequestContext(request);
    rateLimitMocks.consume
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 600 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 42 });

    const response = await enforceGiftMutationRateLimit(request, context, "gift-create", "req-1");

    expect(rateLimitMocks.consume.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      `anonymous:${identity.anonymousDraftId}`,
      "network:ip:203.0.113.10",
    ]);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("42");
  });

  it("charges only the account bucket for signed-in creators", async () => {
    sessionMocks.getCurrentUser.mockResolvedValue({
      email: "creator@example.com",
      id: "creator-1",
      name: "",
      role: "creator",
    });
    const request = new Request("https://example.com/api/gifts");
    const context = await getGiftRequestContext(request);
    rateLimitMocks.consume.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 60 });

    await expect(
      enforceGiftMutationRateLimit(request, context, "gift-update", "req-2"),
    ).resolves.toBeNull();
    expect(rateLimitMocks.consume).toHaveBeenCalledTimes(1);
    expect(rateLimitMocks.consume).toHaveBeenCalledWith(
      "gift-update",
      "user:creator-1",
      "s".repeat(32),
    );
  });
});
