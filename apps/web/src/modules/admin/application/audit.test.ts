import { describe, expect, it, vi } from "vitest";

import {
  AUDIT_RETENTION_MILLISECONDS,
  type AuditLogRepository,
  buildAuditRecord,
  createAuditService,
} from "./audit";

const now = new Date("2026-10-09T10:00:00.000Z");
const giftId = "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89";

describe("audit records", () => {
  it("keeps a record for one year (Records are kept for one year)", () => {
    const record = buildAuditRecord(
      {
        action: "admin.gift.looked_up",
        actor: { id: "user-1", kind: "admin" },
        metadata: { matched: true },
        target: { id: giftId, kind: "gift" },
      },
      "request-1",
      now,
      () => "audit-1",
    );

    expect(record).toEqual({
      action: "admin.gift.looked_up",
      actor: { id: "user-1", kind: "admin" },
      at: now,
      expiresAt: new Date("2027-10-09T10:00:00.000Z"),
      id: "audit-1",
      metadata: { matched: true },
      requestId: "request-1",
      target: { id: giftId, kind: "gift" },
    });
    expect(AUDIT_RETENTION_MILLISECONDS).toBe(365 * 86_400_000);
  });

  it("refuses unknown actions, actor kinds and oversized or sensitive metadata", () => {
    const base = {
      action: "admin.role.granted" as const,
      actor: { id: "lan", kind: "operator" as const },
      target: { id: "user-1", kind: "user" },
    };
    const build = (overrides: Record<string, unknown>) => () =>
      buildAuditRecord({ ...base, ...overrides }, null, now);

    expect(build({ action: "admin.gift.deleted" })).toThrow();
    expect(build({ actor: { id: "x", kind: "creator" } })).toThrow();
    expect(
      build({ metadata: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])) }),
    ).toThrow();
    for (const key of ["email", "code", "shareId", "token", "backupCode", "password"]) {
      expect(build({ metadata: { [key]: "x" } }), key).toThrow();
    }
    expect(build({ metadata: { note: "x".repeat(101) } })).toThrow();
    expect(
      build({ metadata: { failureCode: "STORAGE_DELETE_FAILED", matched: false } }),
    ).not.toThrow();
  });

  it("allows a record without a target or a request", () => {
    expect(
      buildAuditRecord(
        { action: "admin.gift.looked_up", actor: { id: "user-1", kind: "admin" }, target: null },
        null,
        now,
      ),
    ).toMatchObject({ metadata: {}, requestId: null, target: null });
  });
});

describe("audit service", () => {
  it("writes the record and rejects when the write fails (Recording failure fails the action)", async () => {
    const insert = vi.fn<AuditLogRepository["insert"]>(() => Promise.resolve());
    const repository: AuditLogRepository = { insert, listLatest: () => Promise.resolve([]) };
    const service = createAuditService({ clock: () => now, repository });
    const input = {
      action: "admin.mfa.verified" as const,
      actor: { id: "user-1", kind: "admin" as const },
      target: { id: "user-1", kind: "user" },
    };

    await expect(service.record(input, "request-1")).resolves.toMatchObject({
      action: "admin.mfa.verified",
    });
    expect(insert).toHaveBeenCalledOnce();

    insert.mockRejectedValueOnce(new Error("database down"));
    await expect(service.record(input, "request-2")).rejects.toThrow("database down");
  });

  it("exposes no way to change or remove a record", () => {
    const service = createAuditService({
      repository: { insert: () => Promise.resolve(), listLatest: () => Promise.resolve([]) },
    });

    expect(Object.keys(service).sort()).toEqual(["listLatest", "record"]);
  });
});
