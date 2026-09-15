import { type MongoClient } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import { createMongoReadWriteProbe } from "./mongo-spike";

describe("MongoDB read/write spike", () => {
  it("verifies pooled identity, write/read and cleanup", async () => {
    const client = {} as MongoClient;
    const deleteOne = vi.fn(() => Promise.resolve({ acknowledged: true, deletedCount: 1 }));
    const findOne = vi.fn(() =>
      Promise.resolve({
        _id: "probe-1",
        createdAt: new Date("2026-09-15T00:00:00.000Z"),
        kind: "read-write-probe" as const,
      }),
    );
    const insertOne = vi.fn(() => Promise.resolve({ acknowledged: true, insertedId: "probe-1" }));
    const probe = createMongoReadWriteProbe({
      createId: () => "probe-1",
      getClient: () => Promise.resolve(client),
      getProbeCollection: () => Promise.resolve({ deleteOne, findOne, insertOne }),
      now: () => new Date("2026-09-15T00:00:00.000Z"),
    });

    await expect(probe()).resolves.toEqual({
      connectionReused: true,
      readVerified: true,
      writeVerified: true,
    });
    expect(deleteOne).toHaveBeenCalledWith({ _id: "probe-1" });
  });

  it("cleans up even when the read fails", async () => {
    const deleteOne = vi.fn(() => Promise.resolve({ acknowledged: true, deletedCount: 1 }));
    const probe = createMongoReadWriteProbe({
      getClient: () => Promise.resolve({} as MongoClient),
      getProbeCollection: () =>
        Promise.resolve({
          deleteOne,
          findOne: vi.fn(() => Promise.reject(new Error("read failed"))),
          insertOne: vi.fn(() => Promise.resolve({ acknowledged: true, insertedId: "probe-1" })),
        }),
      createId: () => "probe-1",
    });

    await expect(probe()).rejects.toThrow("read failed");
    expect(deleteOne).toHaveBeenCalledOnce();
  });
});
