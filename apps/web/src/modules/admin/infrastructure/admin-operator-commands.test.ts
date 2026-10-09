import { type Db, type MongoClient, UUID } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseAdminCommand, runAdminCommand } from "./admin-operator-commands";

const now = new Date("2026-10-09T10:00:00.000Z");

function fakeDatabase(user: { _id: string | UUID; email: string; role?: string } | null) {
  const collections = {
    adminStepUps: { deleteMany: vi.fn() },
    auditLog: { insertOne: vi.fn() },
    sessions: { deleteMany: vi.fn() },
    twoFactors: { deleteMany: vi.fn() },
    users: { findOne: vi.fn(() => Promise.resolve(user)), updateOne: vi.fn() },
  };
  const session = {
    withTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };
  const database = {
    collection: (name: keyof typeof collections) => collections[name],
  } as unknown as Db;
  const client = {
    withSession: (work: (value: typeof session) => Promise<void>) => work(session),
  } as unknown as Pick<MongoClient, "withSession">;
  return { client, collections, database, session };
}

describe("admin command arguments", () => {
  it("reads the command, a normalized email and the operator", () => {
    expect(parseAdminCommand(["grant", " Owner@Example.test ", "--operator", "lan"])).toEqual({
      command: "grant",
      email: "owner@example.test",
      operator: "lan",
    });
    expect(parseAdminCommand(["reset-mfa", "owner@example.test", "--operator=lan"])).toEqual({
      command: "reset-mfa",
      email: "owner@example.test",
      operator: "lan",
    });
  });

  it("refuses a missing operator name (Missing operator name)", () => {
    expect(() => parseAdminCommand(["grant", "owner@example.test"])).toThrow(
      "Missing operator name",
    );
    expect(() => parseAdminCommand(["grant", "owner@example.test", "--operator"])).toThrow(
      "Missing operator name",
    );
    expect(() =>
      parseAdminCommand(["grant", "owner@example.test", "--operator", "--force"]),
    ).toThrow("Missing operator name");
    expect(() =>
      parseAdminCommand(["grant", "owner@example.test", "--operator", "x".repeat(201)]),
    ).toThrow("Missing operator name");
  });

  it("refuses an unknown command, a missing email and extra arguments", () => {
    expect(() => parseAdminCommand(["promote", "a@b.c", "--operator", "lan"])).toThrow("Usage");
    expect(() => parseAdminCommand(["grant", "--operator", "lan"])).toThrow("Usage");
    expect(() => parseAdminCommand(["grant", "a@b.c", "d@e.f", "--operator", "lan"])).toThrow(
      "Usage",
    );
  });
});

describe("admin commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants the role and records it in one transaction (Grant then revoke)", async () => {
    const { client, collections, database, session } = fakeDatabase({
      _id: "user-1",
      email: "owner@example.test",
      role: "creator",
    });

    await expect(
      runAdminCommand(
        database,
        client,
        { command: "grant", email: "owner@example.test", operator: "lan" },
        now,
      ),
    ).resolves.toEqual({
      command: "grant",
      event: "admin_command",
      outcome: "changed",
      userId: "user-1",
    });

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(collections.users.updateOne).toHaveBeenCalledWith(
      { _id: "user-1" },
      { $set: { role: "admin", updatedAt: now } },
      { session },
    );
    expect(collections.sessions.deleteMany).not.toHaveBeenCalled();
    expect(collections.auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.role.granted",
        actor: { id: "lan", kind: "operator" },
        requestId: null,
        target: { id: "user-1", kind: "user" },
      }),
      { session },
    );
    expect(JSON.stringify(collections.auditLog.insertOne.mock.calls)).not.toContain(
      "owner@example.test",
    );
  });

  it("revokes the role and ends every session and step-up", async () => {
    const { client, collections, database, session } = fakeDatabase({
      _id: "user-1",
      email: "owner@example.test",
      role: "admin",
    });

    await runAdminCommand(
      database,
      client,
      { command: "revoke", email: "owner@example.test", operator: "lan" },
      now,
    );

    expect(collections.users.updateOne).toHaveBeenCalledWith(
      { _id: "user-1" },
      { $set: { role: "creator", updatedAt: now } },
      { session },
    );
    expect(collections.sessions.deleteMany).toHaveBeenCalledWith({ userId: "user-1" }, { session });
    expect(collections.adminStepUps.deleteMany).toHaveBeenCalledWith(
      { userId: "user-1" },
      { session },
    );
    expect(collections.auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.role.revoked" }),
      { session },
    );
  });

  it("resets the factor, ends every session and records admin.mfa.reset", async () => {
    const { client, collections, database, session } = fakeDatabase({
      _id: "user-1",
      email: "owner@example.test",
      role: "admin",
    });

    await runAdminCommand(
      database,
      client,
      { command: "reset-mfa", email: "owner@example.test", operator: "lan" },
      now,
    );

    expect(collections.twoFactors.deleteMany).toHaveBeenCalledWith(
      { userId: "user-1" },
      { session },
    );
    expect(collections.users.updateOne).toHaveBeenCalledWith(
      { _id: "user-1" },
      { $set: { twoFactorEnabled: false, updatedAt: now } },
      { session },
    );
    expect(collections.sessions.deleteMany).toHaveBeenCalled();
    expect(collections.adminStepUps.deleteMany).toHaveBeenCalled();
    expect(collections.auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.mfa.reset" }),
      { session },
    );
  });

  it("handles a user whose id Better Auth stored as a UUID", async () => {
    const stored = new UUID("8b869789-7d9f-474b-ba36-da954357c79d");
    const { client, collections, database, session } = fakeDatabase({
      _id: stored,
      email: "owner@example.test",
      role: "admin",
    });

    await expect(
      runAdminCommand(
        database,
        client,
        { command: "reset-mfa", email: "owner@example.test", operator: "lan" },
        now,
      ),
    ).resolves.toMatchObject({ userId: "8b869789-7d9f-474b-ba36-da954357c79d" });

    expect(collections.users.updateOne).toHaveBeenCalledWith({ _id: stored }, expect.anything(), {
      session,
    });
    expect(collections.sessions.deleteMany).toHaveBeenCalledWith({ userId: stored }, { session });
    expect(collections.twoFactors.deleteMany).toHaveBeenCalledWith({ userId: stored }, { session });
    // Step-ups and the audit hold the string form the application sees.
    expect(collections.adminStepUps.deleteMany).toHaveBeenCalledWith(
      { userId: "8b869789-7d9f-474b-ba36-da954357c79d" },
      { session },
    );
    expect(collections.auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { id: "8b869789-7d9f-474b-ba36-da954357c79d", kind: "user" },
      }),
      { session },
    );
  });

  it("changes and records nothing when granting an admin or revoking a creator", async () => {
    const admin = fakeDatabase({ _id: "user-1", email: "a@example.test", role: "admin" });
    await expect(
      runAdminCommand(admin.database, admin.client, {
        command: "grant",
        email: "a@example.test",
        operator: "lan",
      }),
    ).resolves.toMatchObject({ outcome: "unchanged" });
    expect(admin.collections.users.updateOne).not.toHaveBeenCalled();
    expect(admin.collections.auditLog.insertOne).not.toHaveBeenCalled();

    const creator = fakeDatabase({ _id: "user-2", email: "c@example.test" });
    await expect(
      runAdminCommand(creator.database, creator.client, {
        command: "revoke",
        email: "c@example.test",
        operator: "lan",
      }),
    ).resolves.toMatchObject({ outcome: "unchanged" });
    expect(creator.collections.sessions.deleteMany).not.toHaveBeenCalled();
    expect(creator.collections.auditLog.insertOne).not.toHaveBeenCalled();
  });

  it("fails on an unknown email and changes nothing (Unknown email)", async () => {
    const { client, collections, database } = fakeDatabase(null);

    await expect(
      runAdminCommand(database, client, {
        command: "grant",
        email: "nobody@example.test",
        operator: "lan",
      }),
    ).rejects.toThrow("User not found: nobody@example.test");
    expect(collections.users.updateOne).not.toHaveBeenCalled();
    expect(collections.auditLog.insertOne).not.toHaveBeenCalled();
  });

  it("fails the command when the audit write fails (Recording failure fails the action)", async () => {
    const { client, collections, database } = fakeDatabase({
      _id: "user-1",
      email: "owner@example.test",
      role: "creator",
    });
    collections.auditLog.insertOne.mockRejectedValueOnce(new Error("write conflict"));

    await expect(
      runAdminCommand(database, client, {
        command: "grant",
        email: "owner@example.test",
        operator: "lan",
      }),
    ).rejects.toThrow("write conflict");
  });
});
