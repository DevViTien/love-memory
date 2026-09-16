import { COLLECTIONS } from "@love-memory/database";
import type * as DatabaseModule from "@love-memory/database";
import { createGiftDraft, updateGiftDraft } from "@love-memory/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  getMongoClient: vi.fn(),
}));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { mongoGiftRepository } from "./mongo-gift-repository";

type StoredDocument = Record<string, unknown> & { _id: string };

function valueAtPath(document: StoredDocument, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  }, document);
}

function matches(document: StoredDocument, filter: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(filter).every(([key, value]) => valueAtPath(document, key) === value);
}

class GiftCollection {
  documents: StoredDocument[] = [];

  findOne(filter: Readonly<Record<string, unknown>>) {
    return Promise.resolve(this.documents.find((document) => matches(document, filter)) ?? null);
  }

  findOneAndUpdate(
    filter: Readonly<Record<string, unknown>>,
    update: Readonly<{
      $inc?: Readonly<Record<string, number>>;
      $set?: Readonly<Record<string, unknown>>;
    }>,
  ) {
    const document = this.documents.find((candidate) => matches(candidate, filter));
    if (!document) {
      return Promise.resolve(null);
    }

    Object.assign(document, update.$set);
    for (const [key, increment] of Object.entries(update.$inc ?? {})) {
      document[key] = Number(document[key]) + increment;
    }
    return Promise.resolve(document);
  }

  insertOne(document: StoredDocument) {
    this.documents.push(document);
    return Promise.resolve({ insertedId: document._id });
  }
}

describe("Mongo gift repository", () => {
  const gifts = new GiftCollection();
  const revisions = new GiftCollection();
  const draft = createGiftDraft({
    anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
    claimTokenHash: "a".repeat(64),
    content: {
      data: {},
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.0.0",
    },
    id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
    now: new Date("2026-09-16T00:00:00.000Z"),
    ownerId: null,
    publicId: "q1w2e3r4t5y6u7i8",
  });

  beforeEach(() => {
    gifts.documents = [];
    revisions.documents = [];
    databaseMocks.getDatabase.mockReset();
    databaseMocks.getMongoClient.mockReset();
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => (name === COLLECTIONS.gifts ? gifts : revisions),
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: async (operation: (session: unknown) => Promise<void>) =>
        operation({ withTransaction: (transaction: () => Promise<void>) => transaction() }),
    });
  });

  it("creates the initial immutable revision and enforces anonymous access", async () => {
    await mongoGiftRepository.createDraft(draft);

    await expect(
      mongoGiftRepository.findAuthorized(draft.publicId, {
        anonymousDraftId: draft.ownership.anonymousDraftId!,
        claimTokenHash: draft.ownership.claimTokenHash!,
        kind: "anonymous",
      }),
    ).resolves.toMatchObject({ publicId: draft.publicId });
    await expect(
      mongoGiftRepository.findAuthorized(draft.publicId, {
        isAdmin: false,
        kind: "user",
        userId: "other-user",
      }),
    ).resolves.toBeNull();
    await expect(mongoGiftRepository.findByPublicId(draft.publicId)).resolves.toMatchObject({
      revision: 0,
    });
    expect(revisions.documents).toHaveLength(1);
  });

  it("updates atomically only for the authorized expected revision", async () => {
    await mongoGiftRepository.createDraft(draft);
    const updated = updateGiftDraft(draft, {
      content: { ...draft.content, data: { headline: "Our story" } },
      expectedRevision: 0,
      now: new Date("2026-09-16T01:00:00.000Z"),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      throw new Error("Expected draft update to succeed.");
    }
    const accessor = {
      anonymousDraftId: draft.ownership.anonymousDraftId!,
      claimTokenHash: draft.ownership.claimTokenHash!,
      kind: "anonymous" as const,
    };

    await expect(mongoGiftRepository.updateDraft(updated.data, 0, accessor)).resolves.toMatchObject(
      {
        revision: 1,
      },
    );
    await expect(mongoGiftRepository.updateDraft(updated.data, 0, accessor)).resolves.toBeNull();
    expect(revisions.documents).toHaveLength(2);
  });

  it("claims with both anonymous credentials and clears them", async () => {
    await mongoGiftRepository.createDraft(draft);

    await expect(
      mongoGiftRepository.claimDraft(
        draft.publicId,
        "user-1",
        draft.ownership.anonymousDraftId!,
        "b".repeat(64),
        new Date(),
      ),
    ).resolves.toBeNull();
    await expect(
      mongoGiftRepository.claimDraft(
        draft.publicId,
        "user-1",
        draft.ownership.anonymousDraftId!,
        draft.ownership.claimTokenHash!,
        new Date(),
      ),
    ).resolves.toMatchObject({
      ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-1" },
    });
  });
});
