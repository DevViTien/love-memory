import { type MongoClient, type MongoClientOptions } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import { connectMongoClient, createMongoGateway } from "./client";

describe("MongoDB client connection", () => {
  it("uses bounded pooling and the stable server API", async () => {
    const connect = vi.fn<() => Promise<MongoClient>>();
    const client = {
      close: vi.fn(() => Promise.resolve()),
      connect,
    } as unknown as MongoClient;
    connect.mockResolvedValue(client);
    const factory = vi.fn((_uri: string, _options: MongoClientOptions) => client);

    await expect(
      connectMongoClient({ databaseName: "love_memory", uri: "mongodb://localhost" }, factory),
    ).resolves.toBe(client);

    expect(factory).toHaveBeenCalledWith(
      "mongodb://localhost",
      expect.objectContaining({
        maxPoolSize: 10,
        retryReads: true,
        retryWrites: true,
        waitQueueTimeoutMS: 5000,
      }),
    );
  });

  it("closes a client whose initial connection fails", async () => {
    const connectionError = new Error("unavailable");
    const close = vi.fn(() => Promise.resolve());
    const client = {
      close,
      connect: vi.fn(() => Promise.reject(connectionError)),
    } as unknown as MongoClient;

    await expect(
      connectMongoClient({ databaseName: "love_memory", uri: "mongodb://localhost" }, () => client),
    ).rejects.toBe(connectionError);
    expect(close).toHaveBeenCalledOnce();
  });

  it("provides cached client, database and ping operations through the gateway", async () => {
    const command = vi.fn(() => Promise.resolve({ ok: 1 }));
    const database = { command };
    const connect = vi.fn<() => Promise<MongoClient>>();
    const db = vi.fn(() => database);
    const client = {
      close: vi.fn(() => Promise.resolve()),
      connect,
      db,
    } as unknown as MongoClient;
    connect.mockResolvedValue(client);
    const clientFactory = vi.fn(() => client);
    const gateway = createMongoGateway({
      cache: {},
      clientFactory,
      environment: () => ({ databaseName: "love_memory", uri: "mongodb://localhost" }),
    });

    await expect(gateway.getMongoClient()).resolves.toBe(client);
    await expect(gateway.getMongoClient()).resolves.toBe(client);
    await expect(gateway.getDatabase()).resolves.toBe(database);
    await expect(gateway.pingDatabase()).resolves.toBeUndefined();

    expect(clientFactory).toHaveBeenCalledOnce();
    expect(db).toHaveBeenCalledWith("love_memory");
    expect(command).toHaveBeenCalledWith({ ping: 1 });
  });
});
