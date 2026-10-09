import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getMongoClient: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { buildAuditRecord } from "../application/audit";
import { mongoAdminStepUps } from "./mongo-admin-step-ups";

const now = new Date("2026-10-09T10:00:00.000Z");
const later = new Date("2026-10-09T22:00:00.000Z");

describe("Mongo admin step-ups", () => {
  const stepUps = { findOne: vi.fn(), replaceOne: vi.fn() };
  const auditLog = { insertOne: vi.fn() };
  const session = {
    withTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => {
        if (name === "adminStepUps") return stepUps;
        if (name === "auditLog") return auditLog;
        throw new Error(`Unexpected collection ${name}`);
      },
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: (work: (value: typeof session) => Promise<void>) => work(session),
    });
  });

  it("finds only this session's unexpired step-up of this user", async () => {
    stepUps.findOne.mockResolvedValueOnce({ _id: "key" }).mockResolvedValueOnce(null);

    await expect(mongoAdminStepUps.hasValid("key", "user-1", now)).resolves.toBe(true);
    await expect(mongoAdminStepUps.hasValid("key", "user-1", now)).resolves.toBe(false);
    expect(stepUps.findOne).toHaveBeenCalledWith(
      { _id: "key", expiresAt: { $gt: now }, userId: "user-1" },
      { projection: { _id: 1 } },
    );
  });

  it("records one step-up per session with its audit record in one transaction", async () => {
    const audit = buildAuditRecord(
      {
        action: "admin.mfa.verified",
        actor: { id: "user-1", kind: "admin" },
        target: { id: "user-1", kind: "user" },
      },
      "request-1",
      now,
      () => "audit-1",
    );

    await mongoAdminStepUps.record(
      { expiresAt: later, key: "key", userId: "user-1", verifiedAt: now },
      audit,
    );

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(stepUps.replaceOne).toHaveBeenCalledWith(
      { _id: "key" },
      { expiresAt: later, userId: "user-1", verifiedAt: now },
      { session, upsert: true },
    );
    expect(auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "audit-1", action: "admin.mfa.verified" }),
      { session },
    );
  });
});
