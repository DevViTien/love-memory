import { type ViewerPayloadDto, ViewerPayloadDtoSchema } from "@love-memory/contracts";
import { type Gift, type GiftPublication } from "@love-memory/domain";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";
import {
  activeTrack,
  assetIds,
  completeContent,
  giftId,
  mediaAsset,
  memoryBoxManifest,
} from "@/modules/viewer/test/viewer-fixtures";

import {
  createPublicGiftService,
  type PublicGiftServiceDependencies,
  type PublicViewerPayload,
} from "./public-gift-service";

const shareId = "Ab0_-cdefghijklmnopqrs";
const contentHash = "f".repeat(64);
const publishedAt = new Date("2026-10-01T08:00:00.000Z");

function publishedGift(overrides: Partial<Gift> = {}): Gift {
  return {
    access: { mode: "unlisted" },
    content: {
      // The gift's current fields differ from the snapshot on purpose.
      data: { "receiver-name": "Không dùng" },
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    },
    createdAt: publishedAt,
    id: giftId,
    ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "owner-1" },
    publicId: "q1w2e3r4t5y6u7i8",
    publishedAt,
    publishedRevision: 7,
    // The working copy is ahead of the current publication.
    revision: 10,
    shareId,
    status: "published",
    updatedAt: publishedAt,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GiftPublication> = {}): GiftPublication {
  return {
    artifactContentHash: contentHash,
    assetIds: assetIds.slice(0, 3),
    audioTrackId: activeTrack.id,
    content: completeContent(),
    createdAt: publishedAt,
    giftId,
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    publishedAt,
    revision: 7,
    shareId,
    templateId: "memory-box",
    templateVersion: "1.1.0",
    ...overrides,
  };
}

function recipientSample(): ViewerPayloadDto {
  return {
    artifactUrl: null,
    assets: {},
    assetsExpireAt: null,
    audioUrl: null,
    fields: [],
    payload: completeContent(),
  };
}

describe("public gift service", () => {
  let gift: Gift | null;
  let publication: GiftPublication | null;
  /** Earlier publications of the gift, kept but never served. */
  let superseded: GiftPublication[];
  let findByGiftRevision: ReturnType<
    typeof vi.fn<PublicGiftServiceDependencies["publications"]["findByGiftRevision"]>
  >;
  let registeredHash: string;
  let manifestAvailable: boolean;
  let dependencies: PublicGiftServiceDependencies;
  let findPublishedByShareId: ReturnType<
    typeof vi.fn<PublicGiftServiceDependencies["gifts"]["findPublishedByShareId"]>
  >;

  beforeEach(() => {
    gift = publishedGift();
    publication = snapshot();
    superseded = [];
    findByGiftRevision = vi.fn((requestedGiftId: string, revision: number) =>
      Promise.resolve(
        [...superseded, ...(publication ? [publication] : [])].find(
          (candidate) =>
            candidate.revision === revision &&
            // The fake keeps a publication of another gift reachable, to test the guard.
            (candidate.giftId === requestedGiftId || candidate === publication),
        ) ?? null,
      ),
    );
    registeredHash = contentHash;
    manifestAvailable = true;
    findPublishedByShareId = vi.fn(() => Promise.resolve(gift));
    dependencies = {
      assets: {
        listByIdsForGift: (_giftId, ids) =>
          Promise.resolve(
            ids
              .filter((id) => (assetIds.slice(0, 3) as readonly string[]).includes(id))
              .map((id) => mediaAsset(id)),
          ),
      },
      gifts: { findPublishedByShareId },
      payload: {
        clock: () => publishedAt,
        downloadUrlTtlSeconds: 300,
        findSelectableTrack: (id) => (id === activeTrack.id ? activeTrack : null),
        resolveArtifact: (id, version) =>
          id === "memory-box" && version === "1.1.0" ? { contentHash: registeredHash } : null,
        signDownloadUrl: (key) => Promise.resolve(`https://blob.example/${key}?sig=1`),
      },
      publications: { findByGiftRevision },
      templates: {
        findEditableManifest: (templateId, version) =>
          Promise.resolve(
            manifestAvailable && templateId === "memory-box" && version === "1.1.0"
              ? memoryBoxManifest
              : null,
          ),
      },
    };
  });

  it("builds the payload of the snapshot, not the gift's current content (Payload of the snapshot)", async () => {
    const viewer = await createPublicGiftService(dependencies).openPublicGift(shareId);

    expect(viewer).not.toBeNull();
    expect(viewer?.payload).toEqual(completeContent());
    expect(viewer?.artifactUrl).toBe(
      `/template-artifacts/memory-box/1.1.0/${contentHash}/index.html`,
    );
    expect(Object.keys(viewer?.assets ?? {}).sort()).toEqual([...assetIds.slice(0, 3)].sort());
    expect(viewer?.audioUrl).toBe(activeTrack.url);
    expect(viewer).not.toHaveProperty("issues");
    expect(ViewerPayloadDtoSchema.safeParse(viewer).success).toBe(true);
  });

  it("serves the current publication, never the working copy (Working copy is not served)", async () => {
    await createPublicGiftService(dependencies).openPublicGift(shareId);

    expect(findByGiftRevision).toHaveBeenCalledWith(giftId, 7);
  });

  it("serves the newer publication after an update (Updated gift)", async () => {
    superseded = [snapshot()];
    publication = snapshot({
      content: { ...completeContent(), "final-letter": "Thư đã sửa" },
      id: "1f8fad5b-d9cb-469f-a165-70867728950e",
      revision: 10,
    });
    gift = publishedGift({ publishedRevision: 10 });

    const viewer = await createPublicGiftService(dependencies).openPublicGift(shareId);

    expect(viewer?.payload).toMatchObject({ "final-letter": "Thư đã sửa" });
    expect(findByGiftRevision).toHaveBeenCalledWith(giftId, 10);
  });

  it("still signs a photo detached from the working copy (Detached photo still signed)", async () => {
    const detachedAt = new Date("2026-10-02T00:00:00.000Z");
    dependencies = {
      ...dependencies,
      assets: {
        listByIdsForGift: (_giftId, ids) =>
          Promise.resolve(
            ids.map((id, index) =>
              index === 0
                ? mediaAsset(id, { detachedAt, fieldSlot: null, giftSlot: null })
                : mediaAsset(id),
            ),
          ),
      },
    };

    const viewer = await createPublicGiftService(dependencies).openPublicGift(shareId);

    expect(Object.keys(viewer?.assets ?? {})).toContain(assetIds[0]);
  });

  it("reads exactly the snapshot's asset ids for the gift", async () => {
    const listByIdsForGift = vi.fn<PublicGiftServiceDependencies["assets"]["listByIdsForGift"]>(
      () => Promise.resolve([]),
    );
    dependencies = { ...dependencies, assets: { listByIdsForGift } };

    await createPublicGiftService(dependencies).openPublicGift(shareId);

    expect(listByIdsForGift).toHaveBeenCalledExactlyOnceWith(giftId, assetIds.slice(0, 3));
  });

  it("falls back to the static rendering when the artifact bytes changed (Artifact bytes changed)", async () => {
    registeredHash = "e".repeat(64);

    const viewer = await createPublicGiftService(dependencies).openPublicGift(shareId);

    expect(viewer?.artifactUrl).toBeNull();
    expect(viewer?.payload).toEqual(completeContent());
  });

  it("passes the publication's hash as the expected content hash", async () => {
    publication = snapshot({ artifactContentHash: "d".repeat(64) });

    const viewer = await createPublicGiftService(dependencies).openPublicGift(shareId);

    expect(viewer?.artifactUrl).toBeNull();
  });

  it("rejects a malformed share id without any repository call (Malformed share id)", async () => {
    const service = createPublicGiftService(dependencies);

    await expect(service.resolvePublicGiftPage("abc")).resolves.toBeNull();
    await expect(service.openPublicGift("a".repeat(23))).resolves.toBeNull();
    expect(findPublishedByShareId).not.toHaveBeenCalled();
  });

  const notFoundCases: ReadonlyArray<readonly [string, () => void]> = [
    ["an unknown share id", () => (gift = null)],
    ["a gift that is not published", () => (gift = publishedGift({ status: "paused" }))],
    [
      "an unsupported access policy (Unsupported access policy fails closed)",
      () => (gift = publishedGift({ access: { mode: "password", passwordHash: "h".repeat(40) } })),
    ],
    ["a gift whose share id differs", () => (gift = publishedGift({ shareId: "Z".repeat(22) }))],
    ["a missing publication record (Missing publication record)", () => (publication = null)],
    [
      "no publication for the pointer while an older one exists",
      () => {
        superseded = [snapshot({ revision: 5 })];
        publication = null;
      },
    ],
    [
      "a publication with another share id",
      () => (publication = snapshot({ shareId: "Y".repeat(22) })),
    ],
    [
      "a published gift without a pointer",
      () => (gift = publishedGift({ publishedRevision: undefined })),
    ],
    [
      "a publication of another gift",
      () => (publication = snapshot({ giftId: "9b2f3c1e-0d7a-4a55-9c1b-2f0e6a7d8c90" })),
    ],
    ["a missing manifest", () => (manifestAvailable = false)],
  ];

  it.each(notFoundCases)("gives null from both entry points for %s", async (_name, arrange) => {
    arrange();
    const service = createPublicGiftService(dependencies);

    await expect(service.resolvePublicGiftPage(shareId)).resolves.toBeNull();
    await expect(service.openPublicGift(shareId)).resolves.toBeNull();
  });

  it("reports a live share for the page, without analytics when the port is absent", async () => {
    await expect(
      createPublicGiftService(dependencies).resolvePublicGiftPage(shareId),
    ).resolves.toEqual({ analytics: null });
  });

  it("gives the live page the snapshot template and a giftRef of the internal gift id", async () => {
    // The gift now points at another version: the context follows the publication snapshot.
    gift = publishedGift({
      content: { data: {}, schemaVersion: 1, templateId: "memory-box", templateVersion: "9.9.9" },
    });
    const contextForGift = vi.fn(
      (identity: { id: string; templateId: string; templateVersion: string }) => ({
        giftRef: `ref-${identity.id}`.padEnd(43, "x").slice(0, 43),
        templateId: identity.templateId,
        templateVersion: identity.templateVersion,
      }),
    );
    const page = await createPublicGiftService({
      ...dependencies,
      analytics: { contextForGift },
    }).resolvePublicGiftPage(shareId);

    expect(contextForGift).toHaveBeenCalledWith({
      id: giftId,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    });
    expect(page?.analytics).toEqual(
      expect.objectContaining({ templateId: "memory-box", templateVersion: "1.1.0" }),
    );
  });

  it("gives the live page analytics null while analytics is disabled", async () => {
    await expect(
      createPublicGiftService({
        ...dependencies,
        analytics: { contextForGift: () => null },
      }).resolvePublicGiftPage(shareId),
    ).resolves.toEqual({ analytics: null });
  });

  it("asks for no analytics context when the share is not live", async () => {
    gift = null;
    const contextForGift = vi.fn(() => null);
    await expect(
      createPublicGiftService({
        ...dependencies,
        analytics: { contextForGift },
      }).resolvePublicGiftPage(shareId),
    ).resolves.toBeNull();
    expect(contextForGift).not.toHaveBeenCalled();
  });

  it("keeps the recipient payload type equal to the contract", () => {
    expectTypeOf<keyof PublicViewerPayload>().toEqualTypeOf<keyof ViewerPayloadDto>();
    expectTypeOf<keyof ViewerPayload["fields"][number]>().toEqualTypeOf<
      keyof ViewerPayloadDto["fields"][number]
    >();
    expectTypeOf<ViewerPayload["fields"][number]["type"]>().toEqualTypeOf<
      ViewerPayloadDto["fields"][number]["type"]
    >();
    // Every contract value is a valid recipient payload (assignability is checked by tsc).
    const fromContract: PublicViewerPayload = ViewerPayloadDtoSchema.parse({
      ...recipientSample(),
    });
    expect(fromContract.payload).toEqual(completeContent());
  });
});
