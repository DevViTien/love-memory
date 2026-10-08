import {
  createGiftDraft,
  currentPlan,
  type Gift,
  GiftSchema,
  grantEntitlement,
  type GiftPublication,
  type MediaAsset,
} from "@love-memory/domain";
import { GiftDraftDtoSchema } from "@love-memory/contracts";
import { parseTemplateManifest } from "@love-memory/template-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeTrack,
  assetIds,
  completeContent,
  giftId as fixtureGiftId,
  mediaAsset,
  memoryBoxManifest,
  retiredMemoryBoxManifest,
} from "@/modules/viewer/test/viewer-fixtures";

import {
  type AnalyticsContextFactory,
  changedImageFieldErrors,
  createGiftService,
  type GiftAccessor,
  type GiftCreateIdempotency,
  type GiftMediaReferenceGroup,
  type GiftPublishInput,
  type GiftPublishPersistenceResult,
  type GiftRepository,
  type GiftServiceDependencies,
  type PublishAnalytics,
} from "./gift-service";

const manifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 10, initialMediaKb: 0, maxTextureMb: 4 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.js",
  fields: [
    { id: "headline", label: "Headline", maxLength: 20, required: true, type: "shortText" },
    {
      aspectRatio: "4:3",
      id: "photos",
      label: "Photos",
      maxItems: 2,
      minItems: 0,
      required: false,
      type: "imageList",
    },
    {
      aspectRatio: "4:5",
      captionMaxLength: 40,
      id: "memories",
      label: "Memories",
      maxItems: 8,
      minItems: 3,
      type: "captionedImageList",
    },
    { id: "audio", label: "Music", source: "licensedLibrary", type: "audio" },
  ],
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
    return gift.ownership.ownerId === accessor.userId;
  }
  return (
    gift.ownership.ownerId === null &&
    gift.ownership.anonymousDraftId === accessor.anonymousDraftId &&
    gift.ownership.claimTokenHash === accessor.claimTokenHash
  );
}

function createMemoryRepository(): GiftRepository & {
  current: Gift | null;
  /** Content snapshots written by successful updates, like `giftRevisions`. */
  revisionSnapshots: Gift[];
  idempotency: GiftCreateIdempotency | null;
  lastMediaReferences: readonly GiftMediaReferenceGroup[];
  mediaReferencesValid: boolean;
} {
  return {
    current: null,
    revisionSnapshots: [],
    idempotency: null,
    lastMediaReferences: [],
    mediaReferencesValid: true,
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
    createDraft(gift, idempotency) {
      if (this.idempotency?.key === idempotency.key) {
        return Promise.resolve(
          this.idempotency.actorKey === idempotency.actorKey &&
            this.idempotency.requestFingerprint === idempotency.requestFingerprint &&
            this.current &&
            canAccess(this.current, idempotency.accessor)
            ? { gift: this.current, status: "replayed" as const }
            : { status: "conflict" as const },
        );
      }
      this.current = gift;
      this.idempotency = idempotency;
      return Promise.resolve({ gift, status: "created" });
    },
    findAuthorized(publicId, accessors) {
      const gift = this.current;
      return Promise.resolve(
        gift?.publicId === publicId && accessors.some((accessor) => canAccess(gift, accessor))
          ? gift
          : null,
      );
    },
    findEditableById(giftId) {
      const gift = this.current;
      return Promise.resolve(
        gift?.id === giftId && (gift.status === "draft" || gift.status === "published")
          ? gift
          : null,
      );
    },
    findPublishedByShareId() {
      return Promise.resolve(null);
    },
    findPublishReplay() {
      return Promise.resolve(null);
    },
    publish() {
      return Promise.reject(new Error("Not used by draft tests."));
    },
    validateMediaReferences(_giftId, references) {
      this.lastMediaReferences = references;
      return Promise.resolve(this.mediaReferencesValid);
    },
    updateDraft(gift, expectedRevision, accessors) {
      if (
        this.current?.revision !== expectedRevision ||
        !accessors.some((accessor) => canAccess(this.current!, accessor))
      ) {
        return Promise.resolve(null);
      }
      this.current = gift;
      this.revisionSnapshots.push(gift);
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
      audioTracks: {
        findSelectableTrack: () => null,
        isSelectableTrack: (id) => id === "acoustic-morning",
      },
      clock: () => new Date("2026-09-16T00:00:00.000Z"),
      createAnonymousIdentity: () => anonymousIdentity,
      createId: () => "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      createPublicId: () => "q1w2e3r4t5y6u7i8",
      gifts: repository,
      templates: {
        findCreatableManifest: (templateId, version) =>
          Promise.resolve(
            templateId === manifest.id && version === manifest.version ? manifest : null,
          ),
        findEditableManifest: (templateId, version) =>
          Promise.resolve(
            templateId === manifest.id && version === manifest.version ? manifest : null,
          ),
      },
    });
  });

  async function createAnonymousDraft() {
    return service.createDraft({
      idempotencyKey: "4449d41a-6750-43c1-8dc4-b567ebb20cf2",
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

  it("refuses a draft on a published version without a registered artifact", async () => {
    const withArtifacts = (registered: boolean) =>
      createGiftService({
        audioTracks: { findSelectableTrack: () => null, isSelectableTrack: () => false },
        clock: () => new Date("2026-09-16T00:00:00.000Z"),
        createAnonymousIdentity: () => anonymousIdentity,
        createId: () => "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
        createPublicId: () => "q1w2e3r4t5y6u7i8",
        gifts: repository,
        publishing: {
          artifacts: { resolve: () => (registered ? { contentHash: "a".repeat(64) } : null) },
          assets: { listByGiftId: () => Promise.resolve([]) },
          createShareId: () => "unused",
          plans: { grantFor: () => ({ kind: "grant", source: "free" }) },
        },
        templates: {
          findCreatableManifest: () => Promise.resolve(manifest),
          findEditableManifest: () => Promise.resolve(manifest),
        },
      });
    const input = {
      idempotencyKey: "4449d41a-6750-43c1-8dc4-b567ebb20cf2",
      ownerId: null,
      templateId: manifest.id,
      templateVersion: manifest.version,
    };

    await expect(withArtifacts(false).createDraft(input)).resolves.toEqual({
      error: { code: "NOT_FOUND" },
      ok: false,
    });
    await expect(
      repository.findAuthorized("q1w2e3r4t5y6u7i8", [
        {
          anonymousDraftId: anonymousIdentity.anonymousDraftId,
          claimTokenHash: anonymousIdentity.claimTokenHash,
          kind: "anonymous",
        },
      ]),
    ).resolves.toBeNull();
    await expect(withArtifacts(true).createDraft(input)).resolves.toMatchObject({ ok: true });
  });

  it("authorizes the matching anonymous identity and denies another owner", async () => {
    await createAnonymousDraft();
    const anonymous = await service.getDraft({
      accessors: [
        {
          anonymousDraftId: anonymousIdentity.anonymousDraftId,
          claimTokenHash: anonymousIdentity.claimTokenHash,
          kind: "anonymous",
        },
      ],
      publicId: "q1w2e3r4t5y6u7i8",
    });
    const otherUser = await service.getDraft({
      accessors: [{ kind: "user", userId: "other-user" }],
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
      accessors: [accessor],
      content: { headline: "Our story" },
      expectedRevision: 0,
      publicId: "q1w2e3r4t5y6u7i8",
    });
    const stale = await service.updateDraft({
      accessors: [accessor],
      content: { headline: "Stale" },
      expectedRevision: 0,
      publicId: "q1w2e3r4t5y6u7i8",
    });
    const invalid = await service.updateDraft({
      accessors: [accessor],
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

  it("saves again against the actual revision after a conflict", async () => {
    await createAnonymousDraft();
    const accessor: GiftAccessor = {
      anonymousDraftId: anonymousIdentity.anonymousDraftId,
      claimTokenHash: anonymousIdentity.claimTokenHash,
      kind: "anonymous",
    };
    const update = (headline: string, expectedRevision: number) =>
      service.updateDraft({
        accessors: [accessor],
        content: { headline },
        expectedRevision,
        publicId: "q1w2e3r4t5y6u7i8",
      });

    await update("Tab A", 0);
    const stale = await update("Tab B", 0);
    const snapshotsBefore = repository.revisionSnapshots.length;
    const kept = await update("Tab B", 1);

    expect(stale).toMatchObject({ error: { actualRevision: 1, code: "REVISION_CONFLICT" } });
    expect(kept.ok && kept.data.revision).toBe(2);
    expect(repository.current?.content.data).toEqual({ headline: "Tab B" });
    expect(repository.revisionSnapshots.length).toBe(snapshotsBefore + 1);
  });

  it("rejects media references that are not owned by the current gift field", async () => {
    await createAnonymousDraft();
    repository.mediaReferencesValid = false;

    const result = await service.updateDraft({
      accessors: [
        {
          anonymousDraftId: anonymousIdentity.anonymousDraftId,
          claimTokenHash: anonymousIdentity.claimTokenHash,
          kind: "anonymous",
        },
      ],
      content: {
        headline: "Our story",
        photos: ["550e8400-e29b-41d4-a716-446655440000"],
      },
      expectedRevision: 0,
      publicId: "q1w2e3r4t5y6u7i8",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected draft validation to fail.");
    expect(result.error).toEqual({
      code: "INVALID_CONTENT",
      fieldErrors: { photos: "Image assets must exist and belong to this gift field." },
    });
    expect(repository.current?.revision).toBe(0);
  });

  it("refuses edits when the pinned template version is not editable", async () => {
    await createAnonymousDraft();
    service = createGiftService({
      audioTracks: { findSelectableTrack: () => null, isSelectableTrack: () => true },
      clock: () => new Date("2026-09-16T00:00:00.000Z"),
      createAnonymousIdentity: () => anonymousIdentity,
      createId: () => "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
      createPublicId: () => "q1w2e3r4t5y6u7i8",
      gifts: repository,
      templates: {
        findCreatableManifest: () => Promise.resolve(null),
        findEditableManifest: () => Promise.resolve(null),
      },
    });

    const result = await service.updateDraft({
      accessors: [
        {
          anonymousDraftId: anonymousIdentity.anonymousDraftId,
          claimTokenHash: anonymousIdentity.claimTokenHash,
          kind: "anonymous",
        },
      ],
      content: { headline: "Draft version" },
      expectedRevision: 0,
      publicId: "q1w2e3r4t5y6u7i8",
    });

    expect(result).toEqual({ error: { code: "INVALID_STATE" }, ok: false });
    expect(repository.current?.revision).toBe(0);
  });

  describe("captioned images and licensed audio", () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const accessor: GiftAccessor = {
      anonymousDraftId: anonymousIdentity.anonymousDraftId,
      claimTokenHash: anonymousIdentity.claimTokenHash,
      kind: "anonymous",
    };

    function save(content: Record<string, unknown>) {
      return service.updateDraft({
        accessors: [accessor],
        content,
        expectedRevision: 0,
        publicId: "q1w2e3r4t5y6u7i8",
      });
    }

    it("stores trimmed captions and checks captioned assets like image lists", async () => {
      await createAnonymousDraft();

      const result = await save({ memories: [{ assetId, caption: "  Lần đầu gặp nhau  " }] });

      expect(result.ok && result.data.content).toEqual({
        memories: [{ assetId, caption: "Lần đầu gặp nhau" }],
      });
      expect(repository.lastMediaReferences).toEqual([
        { assetIds: [assetId], fieldId: "memories" },
      ]);
    });

    it("stores a draft with fewer images than the minimum", async () => {
      await createAnonymousDraft();

      const result = await save({ memories: [{ assetId }] });

      expect(result.ok && result.data.revision).toBe(1);
      expect(repository.current?.content.data).toEqual({ memories: [{ assetId }] });
    });

    it("rejects more images than the maximum with an error keyed by the field", async () => {
      await createAnonymousDraft();
      const memories = Array.from({ length: 9 }, (_, index) => ({
        assetId: `550e8400-e29b-41d4-a716-44665544${String(index).padStart(4, "0")}`,
      }));

      const result = await save({ memories });

      expect(result.ok).toBe(false);
      if (result.ok || result.error.code !== "INVALID_CONTENT") {
        throw new Error("Expected invalid content.");
      }
      expect(Object.keys(result.error.fieldErrors).every((key) => key.startsWith("memories"))).toBe(
        true,
      );
      expect(repository.current?.revision).toBe(0);
    });

    it("names the field in a nested error key", async () => {
      await createAnonymousDraft();

      const result = await save({
        memories: [
          { assetId },
          { assetId: "550e8400-e29b-41d4-a716-446655440001", caption: "x".repeat(41) },
        ],
      });

      expect(result.ok ? null : result.error).toMatchObject({
        code: "INVALID_CONTENT",
        fieldErrors: { "memories.1.caption": expect.any(String) as string },
      });
    });

    it("rejects captioned assets that do not belong to this gift field", async () => {
      await createAnonymousDraft();
      repository.mediaReferencesValid = false;

      const result = await save({ memories: [{ assetId }] });

      expect(result).toEqual({
        error: {
          code: "INVALID_CONTENT",
          fieldErrors: { memories: "Image assets must exist and belong to this gift field." },
        },
        ok: false,
      });
      expect(repository.current?.revision).toBe(0);
    });

    it("rejects a captioned item that carries a storage URL", async () => {
      await createAnonymousDraft();

      const result = await save({
        memories: [{ assetId, url: "https://store.example/photo.jpg" }],
      });

      expect(result.ok ? null : result.error.code).toBe("INVALID_CONTENT");
      expect(repository.current?.revision).toBe(0);
    });

    it("stores an active track id", async () => {
      await createAnonymousDraft();

      const result = await save({ audio: "acoustic-morning" });

      expect(result.ok && result.data.content).toEqual({ audio: "acoustic-morning" });
    });

    it.each(["old-piano", "unknown-track"])("rejects the unavailable track %s", async (audio) => {
      await createAnonymousDraft();

      const result = await save({ audio });

      expect(result).toEqual({
        error: { code: "INVALID_CONTENT", fieldErrors: { audio: "Audio track is not available." } },
        ok: false,
      });
      expect(repository.current?.revision).toBe(0);
    });
  });

  it("returns an opaque not-found if ownership changes during an update", async () => {
    await createAnonymousDraft();
    const accessor: GiftAccessor = {
      anonymousDraftId: anonymousIdentity.anonymousDraftId,
      claimTokenHash: anonymousIdentity.claimTokenHash,
      kind: "anonymous",
    };
    repository.updateDraft = () => {
      repository.current = repository.current
        ? {
            ...repository.current,
            ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-2" },
          }
        : null;
      return Promise.resolve(null);
    };

    await expect(
      service.updateDraft({
        accessors: [accessor],
        content: { headline: "Race" },
        expectedRevision: 0,
        publicId: "q1w2e3r4t5y6u7i8",
      }),
    ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
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

  it("answers not-found when reading or saving a gift whose status is not editable (Gift in another status)", async () => {
    await createAnonymousDraft();
    repository.current = GiftSchema.parse({ ...repository.current, status: "paused" });
    const accessors = [
      {
        anonymousDraftId: anonymousIdentity.anonymousDraftId,
        claimTokenHash: anonymousIdentity.claimTokenHash,
        kind: "anonymous" as const,
      },
    ];

    await expect(
      service.updateDraft({
        accessors,
        content: { headline: "After pause" },
        expectedRevision: 0,
        publicId: "q1w2e3r4t5y6u7i8",
      }),
    ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
    await expect(service.getDraft({ accessors, publicId: "q1w2e3r4t5y6u7i8" })).resolves.toEqual({
      error: { code: "NOT_FOUND" },
      ok: false,
    });
  });

  describe("published gift working copy", () => {
    const owner = [{ kind: "user" as const, userId: "owner-1" }];
    const shareId = "Ab0_-cdefghijklmnopqrs";
    const publishedAt = new Date("2026-10-01T00:00:00.000Z");

    async function publishedGift() {
      await createAnonymousDraft();
      repository.current = GiftSchema.parse({
        ...repository.current,
        ...grantEntitlement(currentPlan("free"), "free", publishedAt),
        ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "owner-1" },
        publishedAt,
        publishedRevision: 0,
        shareId,
        status: "published",
      });
    }

    it("reads the working copy with its publication summary (Published gift in the draft API and the Studio)", async () => {
      await publishedGift();

      await expect(
        service.getDraft({ accessors: owner, publicId: "q1w2e3r4t5y6u7i8" }),
      ).resolves.toMatchObject({
        data: {
          publication: {
            publishedAt: publishedAt.toISOString(),
            revision: 0,
            shareId,
            sharePath: `/g/${shareId}`,
          },
          revision: 0,
          status: "published",
        },
        ok: true,
      });
    });

    it("carries the entitlement values the Studio needs, never the source or price (Entitlement in the summary)", async () => {
      await publishedGift();

      const result = await service.getDraft({ accessors: owner, publicId: "q1w2e3r4t5y6u7i8" });

      if (!result.ok) throw new Error("Expected the published gift.");
      expect(result.data.publication).toEqual({
        expiresAt: "2026-10-15T00:00:00.000Z",
        maxPhotos: 3,
        planId: "free",
        publishedAt: publishedAt.toISOString(),
        revision: 0,
        shareId,
        sharePath: `/g/${shareId}`,
        watermark: true,
      });
      expect(GiftDraftDtoSchema.safeParse(result.data).success).toBe(true);
    });

    it("saves the working copy and keeps the current publication (Owner saves a published gift's working copy)", async () => {
      await publishedGift();

      const saved = await service.updateDraft({
        accessors: owner,
        content: { headline: "Sửa sau khi gửi" },
        expectedRevision: 0,
        publicId: "q1w2e3r4t5y6u7i8",
      });

      expect(saved).toMatchObject({
        data: { publication: { revision: 0 }, revision: 1, status: "published" },
        ok: true,
      });
    });

    it("denies another creator and the anonymous cookie (Another creator cannot edit a published gift)", async () => {
      await publishedGift();
      const anonymous = [
        {
          anonymousDraftId: anonymousIdentity.anonymousDraftId,
          claimTokenHash: anonymousIdentity.claimTokenHash,
          kind: "anonymous" as const,
        },
      ];

      for (const accessors of [[{ kind: "user" as const, userId: "someone-else" }], anonymous]) {
        await expect(
          service.updateDraft({
            accessors,
            content: { headline: "Not mine" },
            expectedRevision: 0,
            publicId: "q1w2e3r4t5y6u7i8",
          }),
        ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
      }
    });

    it("refuses to claim a published gift (Claim refused for a published gift)", async () => {
      await publishedGift();

      await expect(
        service.claimDraft({
          anonymousDraftId: anonymousIdentity.anonymousDraftId,
          claimTokenHash: anonymousIdentity.claimTokenHash,
          publicId: "q1w2e3r4t5y6u7i8",
          userId: "owner-1",
        }),
      ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
    });
  });
});

describe("gift publishing", () => {
  const ownerId = "owner-1";
  const publicId = "p1u2b3l4i5s6h7e8";
  const key = "9c1b2f0e-6a7d-4c90-8d7a-4a559c1b2f0e";
  const shareId = "Ab0_-cdefghijklmnopqrs";
  const contentHash = "f".repeat(64);
  const now = new Date("2026-10-01T08:00:00.000Z");

  type StoredKey = Readonly<{ actorKey: string; fingerprint: string; giftId: string }>;
  type ReplayRequest = StoredKey & Readonly<{ revision: number }>;

  let gift: Gift;
  let assets: MediaAsset[];
  let publications: GiftPublication[];
  let keys: Map<string, StoredKey>;
  let standardAvailable: boolean;
  let editable: boolean;
  let publishInputs: GiftPublishInput[];
  let beforeWrite: (() => GiftPublishPersistenceResult | null) | null;
  let service: ReturnType<typeof createGiftService>;

  function ownedGift(overrides: Partial<Gift> = {}): Gift {
    return GiftSchema.parse({
      ...createGiftDraft({
        anonymousDraftId: null,
        claimTokenHash: null,
        content: {
          data: completeContent(),
          schemaVersion: 1,
          templateId: "memory-box",
          templateVersion: "1.1.0",
        },
        id: fixtureGiftId,
        now: new Date("2026-09-16T00:00:00.000Z"),
        ownerId,
        publicId,
      }),
      revision: 7,
      ...overrides,
    });
  }

  /** Photo ids: the fixture's four, then more of the same shape. */
  const photoIds = Array.from(
    { length: 8 },
    (_, index) =>
      assetIds[index] ?? `550e8400-e29b-41d4-a716-4466554400${String(index).padStart(2, "0")}`,
  );

  /** Complete content with `count` photos, and their ready assets. */
  function withPhotos(count: number): Record<string, unknown> {
    assets = photoIds.slice(0, count).map((id) => mediaAsset(id));
    return {
      ...completeContent(),
      memories: photoIds.slice(0, count).map((assetId) => ({ assetId })),
    };
  }

  function replayOf(stored: StoredKey | undefined, request: ReplayRequest) {
    if (!stored) return null;
    if (
      stored.actorKey !== request.actorKey ||
      stored.fingerprint !== request.fingerprint ||
      stored.giftId !== request.giftId
    ) {
      return { status: "idempotency-conflict" as const };
    }
    const publication = publications.find(
      (candidate) => candidate.giftId === stored.giftId && candidate.revision === request.revision,
    );
    return publication
      ? { publication, status: "replayed" as const }
      : { status: "idempotency-conflict" as const };
  }

  const repository: GiftRepository = {
    claimDraft: () => Promise.resolve(null),
    createDraft: () => Promise.reject(new Error("unused")),
    findAuthorized(requestedPublicId, accessors) {
      return Promise.resolve(
        gift.publicId === requestedPublicId &&
          accessors.some((accessor) => canAccess(gift, accessor))
          ? gift
          : null,
      );
    },
    findEditableById: () => Promise.resolve(null),
    findPublishedByShareId: () => Promise.resolve(null),
    findPublishReplay(idempotency, giftId, revision) {
      return Promise.resolve(
        replayOf(keys.get(idempotency.key), {
          actorKey: idempotency.actorKey,
          fingerprint: idempotency.requestFingerprint,
          giftId,
          revision,
        }),
      );
    },
    publish(input) {
      publishInputs.push(input);
      const replay = replayOf(keys.get(input.idempotency.key), {
        actorKey: input.idempotency.actorKey,
        fingerprint: input.idempotency.requestFingerprint,
        giftId: input.gift.id,
        revision: input.expectedRevision,
      });
      if (replay) return Promise.resolve(replay);
      const interrupted = beforeWrite?.();
      if (interrupted) return Promise.resolve(interrupted);
      const precondition = input.precondition;
      const matchesPrecondition =
        precondition.status === "draft"
          ? gift.status === "draft"
          : gift.status === "published" &&
            gift.publishedRevision === precondition.publishedRevision &&
            gift.expiresAt !== undefined &&
            gift.expiresAt.getTime() > precondition.now.getTime();
      if (
        !matchesPrecondition ||
        gift.access.mode !== "unlisted" ||
        gift.revision !== input.expectedRevision ||
        gift.ownership.ownerId !== input.ownerId
      ) {
        return Promise.resolve({ status: "stale" as const });
      }
      if (
        publications.some(
          (candidate) =>
            candidate.giftId === input.gift.id && candidate.revision === input.publication.revision,
        )
      ) {
        return Promise.resolve({ status: "revision-taken" as const });
      }
      gift = input.gift;
      publications.push(input.publication);
      keys.set(input.idempotency.key, {
        actorKey: input.idempotency.actorKey,
        fingerprint: input.idempotency.requestFingerprint,
        giftId: input.gift.id,
      });
      return Promise.resolve({ publication: input.publication, status: "published" as const });
    },
    updateDraft: () => Promise.resolve(null),
    validateMediaReferences: () => Promise.resolve(true),
  };

  function createService(
    overrides: Partial<GiftServiceDependencies> = {},
    options: Readonly<{ withoutPublishing?: boolean }> = {},
  ) {
    const dependencies: GiftServiceDependencies = {
      audioTracks: {
        findSelectableTrack: (id) => (id === activeTrack.id ? activeTrack : null),
        isSelectableTrack: (id) => id === activeTrack.id,
      },
      clock: () => now,
      createAnonymousIdentity: () => {
        throw new Error("unused");
      },
      createId: () => "0f8fad5b-d9cb-469f-a165-70867728950e",
      createPublicId: () => publicId,
      gifts: repository,
      publishing: {
        artifacts: {
          resolve: (templateId, version) =>
            templateId === "memory-box" && version === "1.1.0" ? { contentHash } : null,
        },
        assets: { listByGiftId: () => Promise.resolve(assets) },
        createShareId: () => shareId,
        plans: {
          grantFor: (planId) =>
            planId === "free"
              ? { kind: "grant", source: "free" }
              : standardAvailable
                ? { kind: "grant", source: "internal" }
                : { kind: "unavailable" },
        },
      },
      templates: {
        findCreatableManifest: () => Promise.resolve(null),
        findEditableManifest: (templateId, version) => {
          if (!editable || templateId !== "memory-box") return Promise.resolve(null);
          if (version === "1.1.0") return Promise.resolve(memoryBoxManifest);
          if (version === "1.0.0") return Promise.resolve(retiredMemoryBoxManifest);
          return Promise.resolve(null);
        },
      },
      ...overrides,
    };
    if (!options.withoutPublishing) return createGiftService(dependencies);
    const { publishing: _publishing, ...withoutPublishing } = dependencies;
    return createGiftService(withoutPublishing);
  }

  beforeEach(() => {
    gift = ownedGift();
    assets = assetIds.slice(0, 3).map((id) => mediaAsset(id));
    publications = [];
    keys = new Map();
    standardAvailable = false;
    editable = true;
    publishInputs = [];
    beforeWrite = null;
    service = createService();
  });

  function publish(
    input: Partial<{
      expectedRevision: number;
      idempotencyKey: string;
      planId: "free" | "standard";
      userId: string | null;
    }> = {},
  ) {
    return service.publishGift({
      expectedRevision: 7,
      idempotencyKey: key,
      planId: "free",
      publicId,
      userId: ownerId,
      ...input,
    });
  }

  describe("authorization and entitlement", () => {
    it("answers NOT_AUTHENTICATED without a session (Not signed in)", async () => {
      await expect(publish({ userId: null })).resolves.toEqual({
        error: { code: "NOT_AUTHENTICATED" },
        ok: false,
      });
      expect(gift.status).toBe("draft");
    });

    it("answers NOT_FOUND to a signed-in non-owner (Not the owner)", async () => {
      await expect(publish({ userId: "someone-else" })).resolves.toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
    });

    it("answers NOT_FOUND for an unclaimed anonymous draft (Unclaimed anonymous draft)", async () => {
      gift = ownedGift({
        ownership: {
          anonymousDraftId: "2f7d675f-55d2-4e4b-b017-b0e0f9277ac2",
          claimTokenHash: "a".repeat(64),
          ownerId: null,
        },
      });

      await expect(publish()).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
      expect(gift.status).toBe("draft");
    });

    it("answers NOT_FOUND before any plan check to a non-owner (Plan refusal hidden from non-owners)", async () => {
      await expect(publish({ planId: "standard", userId: "someone-else" })).resolves.toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
    });

    it("refuses when publishing is not configured", async () => {
      service = createService({}, { withoutPublishing: true });

      await expect(publish()).rejects.toThrow("Gift publishing is not configured.");
    });
  });

  describe("pre-publish checks", () => {
    it("answers a revision conflict for a stale revision (Stale revision)", async () => {
      gift = ownedGift({ revision: 5 });

      await expect(publish({ expectedRevision: 4 })).resolves.toEqual({
        error: { actualRevision: 5, code: "REVISION_CONFLICT", expectedRevision: 4 },
        ok: false,
      });
    });

    it("answers NO_UNPUBLISHED_CHANGES to a new key without changes (Already published)", async () => {
      await publish();
      const first = publications[0];

      await expect(
        publish({ idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toEqual({ error: { code: "NO_UNPUBLISHED_CHANGES" }, ok: false });
      expect(publications).toEqual([first]);
    });

    it("answers INVALID_STATE for a status that cannot be published (Status that cannot be published)", async () => {
      gift = GiftSchema.parse({ ...ownedGift(), status: "paused" });

      await expect(publish()).resolves.toEqual({ error: { code: "INVALID_STATE" }, ok: false });
      expect(publishInputs).toHaveLength(0);
    });

    it("checks an update's working copy like a draft (Invalid content in an update)", async () => {
      await publish();
      const content = completeContent();
      delete content["receiver-name"];
      gift = GiftSchema.parse({
        ...gift,
        content: { ...gift.content, data: content },
        revision: 8,
      });

      await expect(
        publish({ expectedRevision: 8, idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toEqual({
        error: {
          code: "INVALID_CONTENT",
          fieldErrors: { "receiver-name": "This field is required." },
        },
        ok: false,
      });
      expect(publications).toHaveLength(1);
      expect(gift.publishedRevision).toBe(7);
    });

    it("lists missing and too few values (Invalid content)", async () => {
      const content = completeContent();
      delete content["receiver-name"];
      content["memories"] = (content["memories"] as unknown[]).slice(0, 2);
      gift = ownedGift({ content: { ...gift.content, data: content } });

      const result = await publish();

      expect(result).toEqual({
        error: {
          code: "INVALID_CONTENT",
          fieldErrors: {
            memories: "Add at least 3 images.",
            "receiver-name": "This field is required.",
          },
        },
        ok: false,
      });
      expect(JSON.stringify(result)).not.toContain("Đà Lạt");
    });

    it("names the photo that is not ready (Asset not ready)", async () => {
      assets[2] = mediaAsset(assetIds[2], { status: "processing" });

      await expect(publish()).resolves.toEqual({
        error: {
          code: "INVALID_CONTENT",
          fieldErrors: { "memories.2": "This image is not ready." },
        },
        ok: false,
      });
      expect(publishInputs).toHaveLength(0);
    });

    it("refuses a withdrawn audio track (Withdrawn audio track)", async () => {
      gift = ownedGift({
        content: { ...gift.content, data: { ...completeContent(), audio: "old-piano" } },
      });

      await expect(publish()).resolves.toEqual({
        error: { code: "INVALID_CONTENT", fieldErrors: { audio: "This value is not valid." } },
        ok: false,
      });
    });

    it("refuses a version without a registered artifact (Artifact missing)", async () => {
      gift = ownedGift({ content: { ...gift.content, templateVersion: "1.0.0" } });

      await expect(publish()).resolves.toEqual({
        error: { code: "TEMPLATE_UNPUBLISHABLE" },
        ok: false,
      });
    });

    it("fails closed for another access policy (Unsupported access policy)", async () => {
      gift = ownedGift({ access: { mode: "password", passwordHash: "h".repeat(40) } });

      await expect(publish()).resolves.toEqual({
        error: { code: "ACCESS_POLICY_UNSUPPORTED" },
        ok: false,
      });
      expect(publishInputs).toHaveLength(0);
    });

    it("refuses a version that is no longer editable (Template version no longer editable)", async () => {
      editable = false;

      await expect(publish()).resolves.toEqual({
        error: { code: "TEMPLATE_NOT_EDITABLE" },
        ok: false,
      });
    });
  });

  describe("plan checks", () => {
    const later = new Date("2026-10-02T09:00:00.000Z");

    async function publishedAndEdited(data: Record<string, unknown>) {
      await publish();
      gift = GiftSchema.parse({ ...gift, content: { ...gift.content, data }, revision: 9 });
    }

    it("refuses Standard while the internal grant is off (Paid plan not available)", async () => {
      await expect(publish({ planId: "standard" })).resolves.toEqual({
        error: { code: "PLAN_NOT_AVAILABLE" },
        ok: false,
      });
      expect(gift.status).toBe("draft");
      expect(publishInputs).toHaveLength(0);
    });

    it("grants Standard through the internal grant (Grant on outside Production)", async () => {
      standardAvailable = true;

      await expect(publish({ planId: "standard" })).resolves.toMatchObject({
        data: { expiresAt: "2027-10-01T08:00:00.000Z", planId: "standard" },
        ok: true,
      });
      expect(gift.entitlement).toMatchObject({
        maxPhotos: null,
        planId: "standard",
        priceVnd: 49_000,
        source: "internal",
        watermark: false,
      });
    });

    it("publishes on Free whatever the internal grant says (Free in Production)", async () => {
      standardAvailable = false;

      await expect(publish({ planId: "free" })).resolves.toMatchObject({
        data: { planId: "free" },
        ok: true,
      });
    });

    it("refuses more photos than Free allows (Too many photos for the Free plan)", async () => {
      gift = ownedGift({ content: { ...gift.content, data: withPhotos(5) } });

      await expect(publish()).resolves.toEqual({
        error: { code: "PLAN_PHOTO_LIMIT_EXCEEDED", maxPhotos: 3, photoCount: 5 },
        ok: false,
      });
      expect(gift.status).toBe("draft");
    });

    it("answers content issues before the photo limit", async () => {
      const data = withPhotos(5);
      delete data["receiver-name"];
      gift = ownedGift({ content: { ...gift.content, data } });

      await expect(publish()).resolves.toMatchObject({
        error: { code: "INVALID_CONTENT" },
        ok: false,
      });
    });

    it("limits an update by the entitlement (Update over the entitlement's photo limit)", async () => {
      await publishedAndEdited(withPhotos(4));
      service = createService({ clock: () => later });

      await expect(
        publish({ expectedRevision: 9, idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toEqual({
        error: { code: "PLAN_PHOTO_LIMIT_EXCEEDED", maxPhotos: 3, photoCount: 4 },
        ok: false,
      });
      expect(gift.publishedRevision).toBe(7);
    });

    it("refuses another plan for an update (Plan change on update refused)", async () => {
      standardAvailable = true;
      await publishedAndEdited({ ...completeContent(), "final-letter": "Thư mới" });

      await expect(
        publish({
          expectedRevision: 9,
          idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
          planId: "standard",
        }),
      ).resolves.toEqual({ error: { code: "PLAN_CHANGE_UNSUPPORTED" }, ok: false });
      expect(gift.entitlement?.planId).toBe("free");
    });

    it("refuses an update after expiry (Update of an expired gift)", async () => {
      await publishedAndEdited({ ...completeContent(), "final-letter": "Thư mới" });
      service = createService({ clock: () => new Date("2026-10-15T08:00:00.000Z") });

      await expect(
        publish({ expectedRevision: 9, idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toEqual({ error: { code: "GIFT_EXPIRED" }, ok: false });
      expect(publishInputs).toHaveLength(1);
    });

    it("answers GIFT_EXPIRED when the write finds the gift expired (Expiry reached during an update)", async () => {
      await publishedAndEdited({ ...completeContent(), "final-letter": "Thư mới" });
      const justBefore = new Date("2026-10-15T07:59:59.999Z");
      service = createService({ clock: () => justBefore });
      beforeWrite = () => {
        // The gift expires between the checks and the write.
        gift = GiftSchema.parse({
          ...gift,
          ...grantEntitlement(currentPlan("free"), "free", new Date("2026-10-01T07:59:59.999Z")),
        });
        return null;
      };

      await expect(
        publish({ expectedRevision: 9, idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toEqual({ error: { code: "GIFT_EXPIRED" }, ok: false });
      expect(publications).toHaveLength(1);
    });

    it("replays a first publish after expiry with its entitlement", async () => {
      await publish();
      service = createService({ clock: () => new Date("2026-11-01T00:00:00.000Z") });

      await expect(publish()).resolves.toMatchObject({
        data: { expiresAt: "2026-10-15T08:00:00.000Z", planId: "free", revision: 7 },
        ok: true,
      });
    });
  });

  describe("the publish transaction", () => {
    it("publishes a complete gift with a pinned snapshot (Owner publishes a complete gift)", async () => {
      const result = await publish();

      expect(result).toEqual({
        data: {
          expiresAt: "2026-10-15T08:00:00.000Z",
          planId: "free",
          publicId,
          publishedAt: now.toISOString(),
          revision: 7,
          shareId,
          sharePath: `/g/${shareId}`,
          status: "published",
        },
        ok: true,
      });
      expect(gift).toMatchObject({ publishedAt: now, revision: 7, shareId, status: "published" });
      // Free entitlement granted (gift-plans "Free entitlement granted").
      expect(gift.entitlement).toEqual({
        grantedAt: now,
        maxPhotos: 3,
        passwordAccess: false,
        planId: "free",
        planVersion: 1,
        priceVnd: 0,
        retentionDays: 14,
        scheduledAccess: false,
        source: "free",
        watermark: true,
      });
      expect(gift.expiresAt).toEqual(new Date("2026-10-15T08:00:00.000Z"));
      expect(publications).toEqual([
        expect.objectContaining({
          artifactContentHash: contentHash,
          assetIds: assetIds.slice(0, 3),
          audioTrackId: "acoustic-morning",
          content: completeContent(),
          revision: 7,
          shareId,
          templateId: "memory-box",
          templateVersion: "1.1.0",
        }),
      ]);
      expect(publishInputs[0]).toMatchObject({
        assetRefs: [{ assetIds: assetIds.slice(0, 3), fieldId: "memories" }],
        expectedRevision: 7,
        idempotency: {
          actorKey: `user:${ownerId}`,
          expiresAt: new Date("2026-10-02T08:00:00.000Z"),
          key,
          requestFingerprint: JSON.stringify(["publish", publicId, 7, "free"]),
          scope: "gift-publish",
        },
        ownerId,
      });
    });

    it("stores no audio track when the content has none", async () => {
      const content = completeContent();
      delete content["audio"];
      gift = ownedGift({ content: { ...gift.content, data: content } });

      await publish();

      expect(publications[0]?.audioTrackId).toBeNull();
    });

    it("answers the newer revision when a save commits first (Concurrent save loses)", async () => {
      beforeWrite = () => {
        gift = ownedGift({ revision: 8 });
        return null;
      };

      await expect(publish()).resolves.toEqual({
        error: { actualRevision: 8, code: "REVISION_CONFLICT", expectedRevision: 7 },
        ok: false,
      });
      expect(publications).toHaveLength(0);
    });

    it("answers NO_UNPUBLISHED_CHANGES when the gift was published elsewhere meanwhile", async () => {
      beforeWrite = () => {
        gift = GiftSchema.parse({
          ...gift,
          ...grantEntitlement(currentPlan("free"), "free", now),
          publishedAt: now,
          publishedRevision: 7,
          shareId,
          status: "published",
        });
        return null;
      };

      await expect(publish()).resolves.toEqual({
        error: { code: "NO_UNPUBLISHED_CHANGES" },
        ok: false,
      });
    });

    it("answers NOT_FOUND when ownership changed meanwhile", async () => {
      beforeWrite = () => {
        gift = ownedGift({
          ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-2" },
        });
        return null;
      };

      await expect(publish()).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
    });

    it("answers ACCESS_POLICY_UNSUPPORTED when the policy changed meanwhile", async () => {
      beforeWrite = () => {
        gift = ownedGift({ access: { mode: "password", passwordHash: "h".repeat(40) } });
        return null;
      };

      await expect(publish()).resolves.toEqual({
        error: { code: "ACCESS_POLICY_UNSUPPORTED" },
        ok: false,
      });
    });

    it("answers invalid content when an asset left ready (Asset deleted during publish)", async () => {
      beforeWrite = () => {
        assets[1] = mediaAsset(assetIds[1], { status: "deleting" });
        return { status: "assets-changed" };
      };

      await expect(publish()).resolves.toEqual({
        error: {
          code: "INVALID_CONTENT",
          fieldErrors: { "memories.1": "This image is not ready." },
        },
        ok: false,
      });
      expect(gift.status).toBe("draft");
      expect(publications).toHaveLength(0);
    });

    it("still answers invalid content when the refreshed list shows no issue", async () => {
      beforeWrite = () => ({ status: "assets-changed" });

      await expect(publish()).resolves.toEqual({
        error: { code: "INVALID_CONTENT", fieldErrors: { memories: "This image is not ready." } },
        ok: false,
      });
    });

    it("answers IDEMPOTENCY_CONFLICT when the transaction finds another request's key", async () => {
      beforeWrite = () => ({ status: "idempotency-conflict" });

      await expect(publish()).resolves.toEqual({
        error: { code: "IDEMPOTENCY_CONFLICT" },
        ok: false,
      });
    });

    it("returns the publication a concurrent same-key request stored (Double click)", async () => {
      await publish();
      const stored = publications[0]!;
      const publishedByTheOther = gift;
      gift = ownedGift();
      beforeWrite = () => {
        // The other request committed first, with its own grant time.
        gift = publishedByTheOther;
        return { publication: stored, status: "replayed" };
      };

      await expect(
        publish({ idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toMatchObject({
        data: { expiresAt: "2026-10-15T08:00:00.000Z", planId: "free", shareId },
        ok: true,
      });
    });
  });

  describe("updates of a published gift", () => {
    const secondKey = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
    const later = new Date("2026-10-02T09:00:00.000Z");

    /** Publishes revision 7, then saves the working copy to revision 9. */
    async function publishedAndEdited() {
      await publish();
      gift = GiftSchema.parse({
        ...gift,
        content: { ...gift.content, data: { ...completeContent(), "final-letter": "Thư mới" } },
        revision: 9,
      });
    }

    it("publishes a newer revision under the same share id (Owner updates a published gift)", async () => {
      await publishedAndEdited();
      service = createService({ clock: () => later });

      const result = await publish({ expectedRevision: 9, idempotencyKey: secondKey });

      expect(result).toEqual({
        data: {
          expiresAt: "2026-10-15T08:00:00.000Z",
          planId: "free",
          publicId,
          publishedAt: later.toISOString(),
          revision: 9,
          shareId,
          sharePath: `/g/${shareId}`,
          status: "published",
        },
        ok: true,
      });
      expect(publications.map(({ revision, shareId: id }) => ({ id, revision }))).toEqual([
        { id: shareId, revision: 7 },
        { id: shareId, revision: 9 },
      ]);
      expect(publications[0]?.publishedAt).toEqual(now);
      expect(gift).toMatchObject({ publishedAt: later, publishedRevision: 9, shareId });
      expect(publishInputs[1]?.precondition).toEqual({
        now: later,
        publishedRevision: 7,
        status: "published",
      });
      // Update keeps the entitlement (gift-plans).
      expect(gift.entitlement?.grantedAt).toEqual(now);
      expect(gift.expiresAt).toEqual(new Date("2026-10-15T08:00:00.000Z"));
    });

    it("answers NO_UNPUBLISHED_CHANGES to a concurrent update of the same revision (Concurrent updates of one revision)", async () => {
      await publishedAndEdited();
      beforeWrite = () => ({ status: "revision-taken" });

      await expect(publish({ expectedRevision: 9, idempotencyKey: secondKey })).resolves.toEqual({
        error: { code: "NO_UNPUBLISHED_CHANGES" },
        ok: false,
      });

      beforeWrite = () => {
        gift = GiftSchema.parse({ ...gift, publishedRevision: 9 });
        return null;
      };
      await expect(
        publish({ expectedRevision: 9, idempotencyKey: "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toEqual({ error: { code: "NO_UNPUBLISHED_CHANGES" }, ok: false });
    });

    it("replays an older key with its own publication (Replay after a later update)", async () => {
      await publishedAndEdited();
      await publish({ expectedRevision: 9, idempotencyKey: secondKey });

      await expect(publish({ expectedRevision: 7 })).resolves.toMatchObject({
        data: { publishedAt: now.toISOString(), revision: 7, shareId },
        ok: true,
      });
      expect(gift.publishedRevision).toBe(9);
      expect(publications).toHaveLength(2);
    });
  });

  describe("idempotent replay", () => {
    it("replays a lost response with the same publication (Lost response replayed)", async () => {
      const first = await publish();
      const second = await publish();

      expect(second).toEqual(first);
      expect(publications).toHaveLength(1);
      expect(publishInputs).toHaveLength(1);
    });

    it("refuses the key of a successful publish with another body (Replay with a different body)", async () => {
      await publish();

      await expect(publish({ expectedRevision: 8 })).resolves.toEqual({
        error: { code: "IDEMPOTENCY_CONFLICT" },
        ok: false,
      });
      await expect(publish({ planId: "standard" })).resolves.toEqual({
        error: { code: "IDEMPOTENCY_CONFLICT" },
        ok: false,
      });
    });

    it("accepts the same key on another plan after a refusal (Retry with another plan after a refusal)", async () => {
      standardAvailable = true;
      gift = ownedGift({ content: { ...gift.content, data: withPhotos(4) } });

      const refused = await publish({ planId: "free" });
      const retried = await publish({ planId: "standard" });

      expect(refused).toEqual({
        error: { code: "PLAN_PHOTO_LIMIT_EXCEEDED", maxPhotos: 3, photoCount: 4 },
        ok: false,
      });
      expect(retried).toMatchObject({ data: { planId: "standard" }, ok: true });
      expect(gift.entitlement).toMatchObject({ planId: "standard", source: "internal" });
    });

    it("accepts the same key after a failed attempt (Retry after a validation failure)", async () => {
      assets[2] = mediaAsset(assetIds[2], { status: "processing" });
      const failed = await publish();
      assets[2] = mediaAsset(assetIds[2]);
      gift = ownedGift({ revision: 8 });

      const retried = await publish({ expectedRevision: 8 });

      expect(failed.ok).toBe(false);
      expect(retried).toMatchObject({ data: { revision: 8, shareId }, ok: true });
    });
  });

  describe("getStudioGift", () => {
    const owner: readonly GiftAccessor[] = [{ kind: "user", userId: ownerId }];

    it("opens the editor for a draft", async () => {
      await expect(service.getStudioGift({ accessors: owner, publicId })).resolves.toMatchObject({
        data: { draft: { publicId, publication: null, revision: 7, status: "draft" } },
        ok: true,
      });
    });

    it("opens the editor with its publication for a published gift", async () => {
      await publish();

      await expect(service.getStudioGift({ accessors: owner, publicId })).resolves.toMatchObject({
        data: {
          analytics: null,
          draft: {
            publication: {
              publishedAt: now.toISOString(),
              revision: 7,
              shareId,
              sharePath: `/g/${shareId}`,
            },
            revision: 7,
            status: "published",
          },
        },
        ok: true,
      });
    });

    it("answers NOT_FOUND for another status and for no access", async () => {
      gift = GiftSchema.parse({ ...ownedGift(), status: "deleting" });
      await expect(service.getStudioGift({ accessors: owner, publicId })).resolves.toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });

      gift = ownedGift();
      await expect(
        service.getStudioGift({ accessors: [{ kind: "user", userId: "other" }], publicId }),
      ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
      await expect(service.getStudioGift({ accessors: [], publicId })).resolves.toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
    });
  });

  describe("funnel analytics ports", () => {
    const owner: readonly GiftAccessor[] = [{ kind: "user", userId: ownerId }];
    const giftRef = "R".repeat(43);
    let giftPublished: ReturnType<typeof vi.fn<PublishAnalytics["giftPublished"]>>;
    let contextForGift: ReturnType<typeof vi.fn<AnalyticsContextFactory>>;

    function withAnalytics(enabled = true) {
      giftPublished = vi.fn<PublishAnalytics["giftPublished"]>();
      contextForGift = vi.fn<AnalyticsContextFactory>((identity) =>
        enabled
          ? {
              giftRef,
              templateId: identity.templateId,
              templateVersion: identity.templateVersion,
            }
          : null,
      );
      service = createService({
        analytics: { contextForGift, publish: { giftPublished } },
      });
    }

    it("gives an authorized draft its analytics context from the internal gift id", async () => {
      withAnalytics();
      const result = await service.getStudioGift({ accessors: owner, publicId });
      expect(result).toMatchObject({
        data: {
          analytics: { giftRef, templateId: "memory-box", templateVersion: "1.1.0" },
        },
        ok: true,
      });
      expect(contextForGift).toHaveBeenCalledWith({
        id: fixtureGiftId,
        templateId: "memory-box",
        templateVersion: "1.1.0",
      });
    });

    it("gives a draft analytics null while disabled or without the port", async () => {
      withAnalytics(false);
      await expect(service.getStudioGift({ accessors: owner, publicId })).resolves.toMatchObject({
        data: { analytics: null, draft: { status: "draft" } },
      });
      service = createService();
      await expect(service.getStudioGift({ accessors: owner, publicId })).resolves.toMatchObject({
        data: { analytics: null, draft: { status: "draft" } },
      });
    });

    it("gives a published gift no analytics context and no access no context at all", async () => {
      withAnalytics();
      await publish();
      contextForGift.mockClear();
      const published = await service.getStudioGift({ accessors: owner, publicId });
      expect(published).toMatchObject({ data: { analytics: null }, ok: true });

      gift = ownedGift();
      await expect(
        service.getStudioGift({ accessors: [{ kind: "user", userId: "other" }], publicId }),
      ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
      expect(contextForGift).not.toHaveBeenCalled();
    });

    it("records gift_published once for a first publish (First publish)", async () => {
      withAnalytics();
      const result = await service.publishGift({
        expectedRevision: 7,
        idempotencyKey: key,
        planId: "free",
        publicId,
        requestId: "request-9",
        userId: ownerId,
      });
      expect(result.ok).toBe(true);
      expect(giftPublished).toHaveBeenCalledTimes(1);
      expect(giftPublished).toHaveBeenCalledWith({
        giftId: fixtureGiftId,
        requestId: "request-9",
        templateId: "memory-box",
        templateVersion: "1.1.0",
      });
    });

    it("records nothing for an update (Update of a published gift)", async () => {
      withAnalytics();
      await publish();
      gift = GiftSchema.parse({ ...gift, revision: 8 });
      await expect(
        publish({ expectedRevision: 8, idempotencyKey: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" }),
      ).resolves.toMatchObject({ data: { revision: 8 }, ok: true });
      expect(giftPublished).toHaveBeenCalledTimes(1);
    });

    it("records nothing for a replayed publish (Replayed publish)", async () => {
      withAnalytics();
      await publish();
      giftPublished.mockClear();
      await expect(publish()).resolves.toMatchObject({ ok: true });
      expect(giftPublished).not.toHaveBeenCalled();
    });

    it("records nothing for any rejected publish (Rejected publish)", async () => {
      withAnalytics();
      await expect(publish({ expectedRevision: 6 })).resolves.toMatchObject({
        error: { code: "REVISION_CONFLICT" },
      });
      await expect(publish({ userId: "someone-else" })).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
      await expect(publish({ planId: "standard" })).resolves.toMatchObject({
        error: { code: "PLAN_NOT_AVAILABLE" },
      });
      assets = [];
      await expect(publish()).resolves.toMatchObject({ error: { code: "INVALID_CONTENT" } });
      expect(giftPublished).not.toHaveBeenCalled();
    });

    it("records nothing when the transaction throws", async () => {
      withAnalytics();
      beforeWrite = () => {
        throw new Error("transaction aborted");
      };
      await expect(publish()).rejects.toThrow("transaction aborted");
      expect(giftPublished).not.toHaveBeenCalled();
    });

    it("still publishes when the port throws synchronously (Analytics write fails)", async () => {
      withAnalytics();
      giftPublished.mockImplementation(() => {
        throw new Error("analytics down");
      });
      await expect(publish()).resolves.toMatchObject({ data: { shareId }, ok: true });
      expect(gift.status).toBe("published");
    });
  });
});

describe("changedImageFieldErrors", () => {
  const references = [
    { assetIds: [assetIds[0], assetIds[1]], fieldId: "memories" },
    { assetIds: [assetIds[2]], fieldId: "cover" },
  ];
  const before = [
    mediaAsset(assetIds[0]),
    mediaAsset(assetIds[1]),
    mediaAsset(assetIds[2], { fieldId: "cover" }),
  ];

  it("names only the fields whose referenced assets changed", () => {
    const after = [before[0]!, mediaAsset(assetIds[1], { status: "deleting" }), before[2]!];

    expect(changedImageFieldErrors(references, before, after)).toEqual({
      memories: "This image is not ready.",
    });
  });

  it("treats a vanished asset as changed", () => {
    expect(changedImageFieldErrors(references, before, before.slice(0, 2))).toEqual({
      cover: "This image is not ready.",
    });
  });

  it("names every referenced field when no difference is visible", () => {
    expect(changedImageFieldErrors(references, before, before)).toEqual({
      cover: "This image is not ready.",
      memories: "This image is not ready.",
    });
  });
});
