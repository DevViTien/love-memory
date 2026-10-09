import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AdminAccess, type AdminSession } from "@/modules/admin/application/admin-access";

import { type ModerationService } from "../application/moderation";
import {
  handleModerationAction,
  type ModerationRouteDependencies,
} from "./moderation-route-handler";

const session: AdminSession = {
  sessionId: "s-1",
  user: { email: "admin@example.test", id: "admin-1", role: "admin", twoFactorEnabled: true },
};
const context = { params: Promise.resolve({ reportId: "report-1" }) };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/admin/reports/report-1", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-request-id": "request-1",
      ...headers,
    },
    method: "POST",
  });
}

describe("POST /api/admin/reports/{reportId}", () => {
  const getAccess = vi.fn<(headers: Headers) => Promise<AdminAccess>>();
  const act = vi.fn<ModerationService["act"]>();
  const limit = vi.fn(() => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }));
  const dependencies: ModerationRouteDependencies = { getAccess, limit, moderation: { act } };
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    getAccess.mockResolvedValue({ kind: "admin", session });
  });

  it("takes a gift down and answers the report's new status", async () => {
    act.mockResolvedValueOnce({ kind: "ok", reportStatus: "actioned" });

    const response = await handleModerationAction(
      post({ action: "takedown" }),
      context,
      dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { reportStatus: "actioned" } });
    expect(act).toHaveBeenCalledWith("report-1", "takedown", {
      id: "admin-1",
      requestId: "request-1",
    });
  });

  it("answers 429 when the admin-action budget is spent", async () => {
    limit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });

    expect(
      (await handleModerationAction(post({ action: "dismiss" }), context, dependencies)).status,
    ).toBe(429);
    expect(act).not.toHaveBeenCalled();
  });

  it("maps not-found and the three conflicts", async () => {
    act.mockResolvedValueOnce({ kind: "not-found" });
    expect(
      (await handleModerationAction(post({ action: "dismiss" }), context, dependencies)).status,
    ).toBe(404);

    for (const [kind, reason] of [
      ["report-closed", "REPORT_CLOSED"],
      ["not-taken-down", "NOT_TAKEN_DOWN"],
      ["gift-gone", "GIFT_GONE"],
    ] as const) {
      act.mockResolvedValueOnce({ kind });
      const response = await handleModerationAction(
        post({ action: "restore" }),
        context,
        dependencies,
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: { details: { reason } } });
    }
  });

  it("answers 404 to creators and 403 MFA_REQUIRED without a step-up (Creator sees no queue)", async () => {
    getAccess.mockResolvedValueOnce({ kind: "none" });
    expect(
      (await handleModerationAction(post({ action: "dismiss" }), context, dependencies)).status,
    ).toBe(404);

    getAccess.mockResolvedValueOnce({ kind: "needs-step-up", session });
    expect(
      (await handleModerationAction(post({ action: "dismiss" }), context, dependencies)).status,
    ).toBe(403);
    expect(act).not.toHaveBeenCalled();
  });

  it("refuses an unknown action, a foreign origin, and answers 500 on failure", async () => {
    expect(
      (await handleModerationAction(post({ action: "ban" }), context, dependencies)).status,
    ).toBe(400);
    expect(
      (
        await handleModerationAction(
          post({ action: "dismiss" }, { origin: "https://attacker.example.test" }),
          context,
          dependencies,
        )
      ).status,
    ).toBe(403);
    act.mockRejectedValueOnce(new Error("down"));
    expect(
      (await handleModerationAction(post({ action: "dismiss" }), context, dependencies)).status,
    ).toBe(500);
  });
});
