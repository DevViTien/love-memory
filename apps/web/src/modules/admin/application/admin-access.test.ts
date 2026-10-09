import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_STEP_UP_MILLISECONDS,
  type AdminSession,
  recordStepUp,
  resolveAdminAccess,
  stepUpKey,
} from "./admin-access";
import { buildAuditRecord } from "./audit";

const now = new Date("2026-10-09T10:00:00.000Z");

function session(overrides: Partial<AdminSession["user"]> = {}): AdminSession {
  return {
    sessionId: "session-1",
    user: {
      email: "admin@example.test",
      id: "user-1",
      role: "admin",
      twoFactorEnabled: true,
      ...overrides,
    },
  };
}

describe("admin access", () => {
  const valid = { hasValid: vi.fn(() => Promise.resolve(true)) };
  const invalid = { hasValid: vi.fn(() => Promise.resolve(false)) };

  it("treats no session and a creator alike (Signed-out visitor sees nothing, Creator sees nothing)", async () => {
    await expect(resolveAdminAccess({ now, session: null, stepUps: valid })).resolves.toEqual({
      kind: "none",
    });
    await expect(
      resolveAdminAccess({ now, session: session({ role: "creator" }), stepUps: valid }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("sends an admin without a factor to enrollment", async () => {
    await expect(
      resolveAdminAccess({ now, session: session({ twoFactorEnabled: false }), stepUps: valid }),
    ).resolves.toMatchObject({ kind: "needs-enrollment" });
  });

  it("asks for a step-up when this session has none (Admin without a step-up)", async () => {
    await expect(
      resolveAdminAccess({ now, session: session(), stepUps: invalid }),
    ).resolves.toMatchObject({
      kind: "needs-step-up",
    });
    expect(invalid.hasValid).toHaveBeenCalledWith(stepUpKey("session-1"), "user-1", now);
  });

  it("lets an admin with a valid step-up in", async () => {
    await expect(
      resolveAdminAccess({ now, session: session(), stepUps: valid }),
    ).resolves.toMatchObject({
      kind: "admin",
    });
  });

  it("keys step-ups by a hash of the session id, so sessions never share one (Step-up does not travel between sessions)", () => {
    expect(stepUpKey("session-1")).toMatch(/^[a-f0-9]{64}$/);
    expect(stepUpKey("session-1")).not.toBe(stepUpKey("session-2"));
    expect(stepUpKey("session-1")).not.toContain("session-1");
  });

  it("records a 12-hour step-up for the session with its audit record (Step-up expires)", async () => {
    const record = vi.fn(() => Promise.resolve());
    const audit = buildAuditRecord(
      {
        action: "admin.mfa.verified",
        actor: { id: "user-1", kind: "admin" },
        target: { id: "user-1", kind: "user" },
      },
      "request-1",
      now,
    );

    await recordStepUp({ record }, session(), now, audit);

    expect(record).toHaveBeenCalledWith(
      {
        expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        key: stepUpKey("session-1"),
        userId: "user-1",
        verifiedAt: now,
      },
      audit,
    );
    expect(ADMIN_STEP_UP_MILLISECONDS).toBe(43_200_000);
  });
});
