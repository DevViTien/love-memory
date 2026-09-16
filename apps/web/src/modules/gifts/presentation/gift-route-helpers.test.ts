import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/composition/session", () => ({ getCurrentUser: sessionMocks.getCurrentUser }));

import {
  createAnonymousDraftIdentity,
  serializeAnonymousDraftCookie,
} from "../infrastructure/anonymous-draft-identity";
import {
  getGiftRequestContext,
  giftDraftResponse,
  giftServiceErrorResponse,
  requestId,
} from "./gift-route-helpers";

describe("gift route helpers", () => {
  beforeEach(() => {
    sessionMocks.getCurrentUser.mockReset();
    sessionMocks.getCurrentUser.mockResolvedValue(null);
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
    expect(authenticated.accessors).toEqual([{ isAdmin: true, kind: "user", userId: "admin-1" }]);
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

  it("wraps draft DTOs in the common success envelope", async () => {
    const response = giftDraftResponse({ publicId: "gift-1" }, "request-1", 201);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { gift: { publicId: "gift-1" } } });
  });
});
