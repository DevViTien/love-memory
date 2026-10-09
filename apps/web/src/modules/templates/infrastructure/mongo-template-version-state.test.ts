import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getMongoClient: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { mongoTemplateVersionState } from "./mongo-template-version-state";

const now = new Date("2026-10-10T08:00:00.000Z");
const base = {
  actorId: "admin-1",
  now,
  requestId: "r-1",
  templateId: "memory-box",
  version: "1.1.0",
} as const;

describe("Mongo template version state", () => {
  const templateVersions = { find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() };
  const templates = { find: vi.fn(), findOne: vi.fn() };
  const auditLog = { insertOne: vi.fn() };
  const session = {
    withTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => ({ auditLog, templateVersions, templates })[name],
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: (work: (value: typeof session) => Promise<void>) => work(session),
    });
  });

  it("retires only a published version, with its audit record in the transaction (Retire a published version)", async () => {
    templateVersions.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(mongoTemplateVersionState.transition({ ...base, action: "retire" })).resolves.toBe(
      true,
    );

    expect(templateVersions.updateOne).toHaveBeenCalledWith(
      { _id: "memory-box@1.1.0", status: "published" },
      [{ $set: { adminRetiredAt: now, status: "retired", updatedAt: now } }],
      { session },
    );
    expect(auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.template.retired",
        actor: { id: "admin-1", kind: "admin" },
        metadata: {},
        requestId: "r-1",
        target: { id: "memory-box@1.1.0", kind: "template-version" },
      }),
      { session },
    );
  });

  it("kills a released, not yet killed version and records the reason", async () => {
    templateVersions.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    await mongoTemplateVersionState.transition({ ...base, action: "kill", reason: "security" });

    expect(templateVersions.updateOne).toHaveBeenCalledWith(
      {
        _id: "memory-box@1.1.0",
        killedAt: { $not: { $type: "date" } },
        status: { $in: ["published", "retired"] },
      },
      [
        {
          $set: {
            adminRetiredAt: { $ifNull: ["$adminRetiredAt", now] },
            killReason: "security",
            killedAt: now,
            status: "retired",
            updatedAt: now,
          },
        },
      ],
      { session },
    );
    expect(auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.template.killed",
        metadata: { reason: "security" },
      }),
      { session },
    );
  });

  it("restores only a killed version and keeps it retired (Restore keeps the version retired)", async () => {
    templateVersions.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    await mongoTemplateVersionState.transition({ ...base, action: "restore" });

    expect(templateVersions.updateOne).toHaveBeenCalledWith(
      { _id: "memory-box@1.1.0", killedAt: { $type: "date" } },
      [{ $set: { killReason: null, killedAt: null, updatedAt: now } }],
      { session },
    );
    expect(auditLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.template.restored", metadata: {} }),
      { session },
    );
  });

  it("records nothing when the transition changes nothing", async () => {
    templateVersions.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });

    await expect(
      mongoTemplateVersionState.transition({ ...base, action: "restore" }),
    ).resolves.toBe(false);
    expect(auditLog.insertOne).not.toHaveBeenCalled();
  });

  it("fails the action when the audit write fails", async () => {
    templateVersions.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
    auditLog.insertOne.mockRejectedValueOnce(new Error("audit down"));

    await expect(
      mongoTemplateVersionState.transition({ ...base, action: "retire" }),
    ).rejects.toThrow("audit down");
  });

  it("reads one version's state with its current marker and kill reason", async () => {
    templateVersions.findOne.mockResolvedValueOnce({
      _id: "memory-box@1.1.0",
      killReason: "broken",
      killedAt: now,
      status: "retired",
      templateId: "memory-box",
      version: "1.1.0",
    });
    templates.findOne.mockResolvedValueOnce({ _id: "memory-box", currentVersion: "1.1.0" });

    await expect(mongoTemplateVersionState.findState("memory-box", "1.1.0")).resolves.toEqual({
      current: true,
      killReason: "broken",
      killed: true,
      status: "retired",
      templateId: "memory-box",
      version: "1.1.0",
    });

    templateVersions.findOne.mockResolvedValueOnce(null);
    templates.findOne.mockResolvedValueOnce(null);
    await expect(mongoTemplateVersionState.findState("memory-box", "9.9.9")).resolves.toBeNull();
  });

  it("looks a kill up by the version id", async () => {
    templateVersions.findOne.mockResolvedValueOnce({ _id: "memory-box@1.1.0" });
    await expect(mongoTemplateVersionState.isKilled("memory-box", "1.1.0")).resolves.toBe(true);
    expect(templateVersions.findOne).toHaveBeenCalledWith(
      { _id: "memory-box@1.1.0", killedAt: { $type: "date" } },
      { projection: { _id: 1 } },
    );

    templateVersions.findOne.mockResolvedValueOnce(null);
    await expect(mongoTemplateVersionState.isKilled("memory-box", "1.1.0")).resolves.toBe(false);
  });

  it("lists every version by template, newest version first", async () => {
    templateVersions.find.mockReturnValueOnce({
      toArray: () =>
        Promise.resolve([
          {
            _id: "memory-box@1.9.0",
            status: "retired",
            templateId: "memory-box",
            version: "1.9.0",
          },
          {
            _id: "our-timeline@1.0.0",
            status: "published",
            templateId: "our-timeline",
            version: "1.0.0",
          },
          {
            _id: "memory-box@1.10.0",
            status: "published",
            templateId: "memory-box",
            version: "1.10.0",
          },
        ]),
    });
    templates.find.mockReturnValueOnce({
      toArray: () => Promise.resolve([{ _id: "memory-box", currentVersion: "1.10.0" }]),
    });

    const versions = await mongoTemplateVersionState.listVersions();

    expect(versions.map((version) => `${version.templateId}@${version.version}`)).toEqual([
      "memory-box@1.10.0",
      "memory-box@1.9.0",
      "our-timeline@1.0.0",
    ]);
    expect(versions[0]).toMatchObject({ current: true, killed: false, killReason: null });
    expect(versions[2]).toMatchObject({ current: false });
  });
});
