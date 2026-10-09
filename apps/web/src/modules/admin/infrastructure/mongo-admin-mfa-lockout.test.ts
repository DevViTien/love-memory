import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
}));

import { mongoAdminMfaLockout } from "./mongo-admin-mfa-lockout";

const now = new Date("2026-10-09T10:00:00.000Z");

describe("Mongo admin MFA lockout", () => {
  const collection = { findOne: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => {
        expect(name).toBe("twoFactors");
        return collection;
      },
    });
  });

  it("reads only an active lock of the admin's factor", async () => {
    const until = new Date(now.getTime() + 60_000);
    collection.findOne.mockResolvedValueOnce({ lockedUntil: until }).mockResolvedValueOnce(null);

    await expect(mongoAdminMfaLockout.lockedUntil("user-1", now)).resolves.toBe(until);
    await expect(mongoAdminMfaLockout.lockedUntil("user-1", now)).resolves.toBeNull();
    expect(collection.findOne).toHaveBeenCalledWith(
      { lockedUntil: { $gt: now }, userId: { $in: ["user-1"] } },
      { projection: { _id: 0, lockedUntil: 1 } },
    );
  });

  it("counts a failure atomically and locks for 15 minutes at the tenth", async () => {
    collection.findOneAndUpdate
      .mockResolvedValueOnce({ failedVerificationCount: 9 })
      .mockResolvedValueOnce({ failedVerificationCount: 10 });

    await mongoAdminMfaLockout.recordFailure("user-1", now);
    expect(collection.updateOne).not.toHaveBeenCalled();

    await mongoAdminMfaLockout.recordFailure("user-1", now);
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: { $in: ["user-1"] } },
      { $inc: { failedVerificationCount: 1 } },
      { projection: { _id: 0, failedVerificationCount: 1 }, returnDocument: "after" },
    );
    expect(collection.updateOne).toHaveBeenCalledWith(
      { failedVerificationCount: { $gte: 10 }, userId: { $in: ["user-1"] } },
      {
        $set: {
          failedVerificationCount: 0,
          lockedUntil: new Date(now.getTime() + 15 * 60 * 1000),
        },
      },
    );
  });

  it("counts nothing for an admin without a factor record", async () => {
    collection.findOneAndUpdate.mockResolvedValueOnce(null);

    await mongoAdminMfaLockout.recordFailure("user-1", now);

    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it("clears the count and the lock after a valid code", async () => {
    await mongoAdminMfaLockout.clear("user-1");

    expect(collection.updateOne).toHaveBeenCalledWith(
      { userId: { $in: ["user-1"] } },
      { $set: { failedVerificationCount: 0, lockedUntil: null } },
    );
  });
});
