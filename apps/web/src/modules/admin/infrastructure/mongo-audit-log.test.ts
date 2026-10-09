import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { type AuditRecord } from "../application/audit";
import { mongoAuditLog } from "./mongo-audit-log";

const at = new Date("2026-10-09T10:00:00.000Z");
const record: AuditRecord = {
  action: "admin.gift.looked_up",
  actor: { id: "user-1", kind: "admin" },
  at,
  expiresAt: new Date("2027-10-09T10:00:00.000Z"),
  id: "audit-1",
  metadata: { matched: true },
  requestId: "request-1",
  target: { id: "gift-1", kind: "gift" },
};

describe("Mongo audit log", () => {
  const toArray = vi.fn();
  const limit = vi.fn(() => ({ toArray }));
  const sort = vi.fn(() => ({ limit }));
  const collection = { find: vi.fn(() => ({ sort })), insertOne: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => {
        expect(name).toBe("auditLog");
        return collection;
      },
    });
  });

  it("inserts the record under its id", async () => {
    await mongoAuditLog.insert(record);

    const { id, ...fields } = record;
    expect(collection.insertOne).toHaveBeenCalledWith({ _id: id, ...fields }, {});
  });

  it("lists the newest records, optionally for one target", async () => {
    const { id, ...fields } = record;
    toArray.mockResolvedValue([{ _id: id, ...fields }]);

    await expect(mongoAuditLog.listLatest({ limit: 100 })).resolves.toEqual([record]);
    expect(collection.find).toHaveBeenLastCalledWith({});
    expect(sort).toHaveBeenLastCalledWith({ at: -1 });
    expect(limit).toHaveBeenLastCalledWith(100);

    await mongoAuditLog.listLatest({ limit: 100, targetId: "gift-1" });
    expect(collection.find).toHaveBeenLastCalledWith({ "target.id": "gift-1" });
  });

  it("has no update or delete", () => {
    expect(Object.keys(mongoAuditLog).sort()).toEqual(["insert", "listLatest"]);
  });
});
