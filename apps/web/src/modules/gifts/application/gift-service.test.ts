import { type Gift } from "@love-memory/domain";
import { parseTemplateManifest } from "@love-memory/template-sdk";
import { beforeEach, describe, expect, it } from "vitest";

import { createGiftService, type GiftAccessor, type GiftRepository } from "./gift-service";

const manifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 10, initialMediaKb: 0, maxTextureMb: 4 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.js",
  fields: [{ id: "headline", label: "Headline", maxLength: 20, required: true, type: "shortText" }],
  id: "memory-box",
  meta: {
    description: "A memory box",
    estimatedDurationSec: 60,
    moods: ["warm"],
    name: "Memory Box",
    occasions: ["anniversary"],
  },
  previewFixture: "fixture.json",
  status: "published",
  version: "1.0.0",
});

function canAccess(gift: Gift, accessor: GiftAccessor): boolean {
  if (accessor.kind === "user") {
    return accessor.isAdmin || gift.ownership.ownerId === accessor.userId;
  }
  return (
    gift.ownership.ownerId === null &&
    gift.ownership.anonymousDraftId === accessor.anonymousDraftId &&
    gift.ownership.claimTokenHash === accessor.claimTokenHash
  );
}

function createMemoryRepository(): GiftRepository & { current: Gift | null } {
  return {
    current: null,
    claimDraft(publicId, ownerId, anonymousDraftId, claimTokenHash, now) {
      const gift = this.current;
      if (
        !gift ||
        gift.publicId !== publicId ||
        gift.ownership.anonymousDraftId !== anonymousDraftId ||
        gift.ownership.claimTokenHash !== claimTokenHash
      ) {
        return Promise.resolve(null);
      }
      this.current = {
        ...gift,
        ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId },
        updatedAt: now,
      };
      return Promise.resolve(this.current);
    },
    createDraft(gift) {
      this.current = gift;
      return Promise.resolve();
    },
    findAuthorized(publicId, accessor) {
      const gift = this.current;
      return Promise.resolve(
        gift?.publicId === publicId && canAccess(gift, accessor) ? gift : null,
      );
    },
    findByPublicId(publicId) {
      return Promise.resolve(this.current?.publicId === publicId ? this.current : null);
    },
    updateDraft(gift, expectedRevision, accessor) {
      if (this.current?.revision !== expectedRevision || !canAccess(this.current, accessor)) {
        return Promise.resolve(null);
      }
      this.current = gift;
      return Promise.resolve(gift);
    },
  };
}

describe("gift application service", () => {
  const anonymousIdentity = {
    anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
    claimToken: "secret-token",
    claimTokenHash: "a".repeat(64),
  };
  let repository: ReturnType<typeof createMemoryRepository>;
  let service: ReturnType<typeof createGiftService>;

  beforeEach(() => {
    repository = createMemoryRepository();
    service = createGiftService({
      clock: () => new Date("2026-09-16T00:00:00.000Z"),
      createAnonymousIdentity: () => anonymousIdentity,
      createId: () => "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      createPublicId: () => "q1w2e3r4t5y6u7i8",
      gifts: repository,
      templates: {
        findPublishedManifest: (templateId, version) =>
          Promise.resolve(
            templateId === manifest.id && version === manifest.version ? manifest : null,
          ),
      },
    });
  });

  async function createAnonymousDraft() {
    return service.createDraft({
      ownerId: null,
      templateId: manifest.id,
      templateVersion: manifest.version,
    });
  }

  it("creates an anonymous draft and keeps its secret out of the DTO", async () => {
    const result = await createAnonymousDraft();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gift).toMatchObject({ ownerKind: "anonymous", revision: 0 });
      expect(result.data.gift).not.toHaveProperty("claimTokenHash");
    }
  });

  it("authorizes the matching anonymous identity and denies another owner", async () => {
    await createAnonymousDraft();
    const anonymous = await service.getDraft({
      accessor: {
        anonymousDraftId: anonymousIdentity.anonymousDraftId,
        claimTokenHash: anonymousIdentity.claimTokenHash,
        kind: "anonymous",
      },
      publicId: "q1w2e3r4t5y6u7i8",
    });
    const otherUser = await service.getDraft({
      accessor: { isAdmin: false, kind: "user", userId: "other-user" },
      publicId: "q1w2e3r4t5y6u7i8",
    });

    expect(anonymous.ok).toBe(true);
    expect(otherUser).toEqual({ error: { code: "NOT_FOUND" }, ok: false });
  });

  it("validates template content and preserves newer revisions on conflict", async () => {
    await createAnonymousDraft();
    const accessor: GiftAccessor = {
      anonymousDraftId: anonymousIdentity.anonymousDraftId,
      claimTokenHash: anonymousIdentity.claimTokenHash,
      kind: "anonymous",
    };

    const saved = await service.updateDraft({
      accessor,
      content: { headline: "Our story" },
      expectedRevision: 0,
      publicId: "q1w2e3r4t5y6u7i8",
    });
    const stale = await service.updateDraft({
      accessor,
      content: { headline: "Stale" },
      expectedRevision: 0,
      publicId: "q1w2e3r4t5y6u7i8",
    });
    const invalid = await service.updateDraft({
      accessor,
      content: { unknown: "not declared" },
      expectedRevision: 1,
      publicId: "q1w2e3r4t5y6u7i8",
    });

    expect(saved.ok && saved.data.revision).toBe(1);
    expect(stale).toEqual({
      error: { actualRevision: 1, code: "REVISION_CONFLICT", expectedRevision: 0 },
      ok: false,
    });
    expect(invalid).toMatchObject({ error: { code: "INVALID_CONTENT" }, ok: false });
    expect(repository.current?.content.data).toEqual({ headline: "Our story" });
  });

  it("claims only with both authenticated user and matching anonymous credentials", async () => {
    await createAnonymousDraft();
    const denied = await service.claimDraft({
      anonymousDraftId: anonymousIdentity.anonymousDraftId,
      claimTokenHash: "b".repeat(64),
      publicId: "q1w2e3r4t5y6u7i8",
      userId: "user-1",
    });
    const claimed = await service.claimDraft({
      anonymousDraftId: anonymousIdentity.anonymousDraftId,
      claimTokenHash: anonymousIdentity.claimTokenHash,
      publicId: "q1w2e3r4t5y6u7i8",
      userId: "user-1",
    });

    expect(denied).toEqual({ error: { code: "NOT_FOUND" }, ok: false });
    expect(claimed.ok && claimed.data.ownerKind).toBe("user");
  });
});
