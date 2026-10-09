import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AdminSession } from "./admin-access";
import {
  type AdminGiftSummary,
  type AdminGiftTombstone,
  createGiftLookupService,
} from "./gift-lookup";

const session: AdminSession = {
  sessionId: "session-1",
  user: { email: "admin@example.test", id: "admin-1", role: "admin", twoFactorEnabled: true },
};

const summary: AdminGiftSummary = {
  assetCounts: { ready: 2 },
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  expiresAt: new Date("2026-11-01T00:00:00.000Z"),
  id: "8a0c1c1e-1111-4111-8111-111111111111",
  owner: { email: "owner@example.test", id: "user-1", kind: "user" },
  planId: "free",
  publicId: "abcDEF123456",
  publishedAt: new Date("2026-10-02T00:00:00.000Z"),
  publishedRevision: 3,
  revision: 3,
  status: "published",
  templateId: "memory-box",
  templateVersion: "1.0.0",
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
};

describe("admin gift lookup", () => {
  const record = vi.fn();
  const findSummary = vi.fn<(query: string) => Promise<AdminGiftSummary | null>>();
  const findTombstone = vi.fn<(query: string) => Promise<AdminGiftTombstone | null>>();
  const service = createGiftLookupService({
    audit: { record },
    repository: { findSummary, findTombstone },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits a match with the gift's internal id, never the query (Lookup by share id is not leaked)", async () => {
    findSummary.mockResolvedValueOnce(summary);

    await expect(
      service.lookup({ query: "  share-id-secret  ", requestId: "r-1", session }),
    ).resolves.toEqual({ gift: summary, kind: "found" });

    expect(findSummary).toHaveBeenCalledWith("share-id-secret");
    expect(record).toHaveBeenCalledWith(
      {
        action: "admin.gift.looked_up",
        actor: { id: "admin-1", kind: "admin" },
        metadata: { matched: true },
        target: { id: summary.id, kind: "gift" },
      },
      "r-1",
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain("share-id-secret");
  });

  it("finds a purged gift's tombstone and audits its id (Lookup of a deleted gift)", async () => {
    const tombstone: AdminGiftTombstone = {
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      deletedAt: new Date("2026-10-10T12:00:00.000Z"),
      deletionRequestedAt: new Date("2026-10-10T11:00:00.000Z"),
      id: summary.id,
      ownerId: "user-1",
      publicId: "abcDEF123456",
      publishedAt: null,
    };
    findSummary.mockResolvedValueOnce(null);
    findTombstone.mockResolvedValueOnce(tombstone);

    await expect(
      service.lookup({ query: "abcDEF123456", requestId: "r-1", session }),
    ).resolves.toEqual({ kind: "deleted", tombstone });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { matched: true },
        target: { id: summary.id, kind: "gift" },
      }),
      "r-1",
    );
  });

  it("audits a miss without a target (Nothing found)", async () => {
    findSummary.mockResolvedValueOnce(null);

    await expect(service.lookup({ query: "nothing", requestId: "r-1", session })).resolves.toEqual({
      kind: "not-found",
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { matched: false }, target: null }),
      "r-1",
    );
  });

  it("does not query an over-long value, but still audits the search", async () => {
    await expect(
      service.lookup({ query: "x".repeat(65), requestId: "r-1", session }),
    ).resolves.toEqual({ kind: "not-found" });
    expect(findSummary).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty query", async () => {
    await expect(service.lookup({ query: "   ", requestId: null, session })).resolves.toEqual({
      kind: "empty",
    });
    expect(findSummary).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("shows nothing when the audit write fails", async () => {
    findSummary.mockResolvedValueOnce(summary);
    record.mockRejectedValueOnce(new Error("audit down"));

    await expect(
      service.lookup({ query: "abcDEF123456", requestId: "r-1", session }),
    ).rejects.toThrow("audit down");
  });
});
