import { type Gift } from "@love-memory/domain";
import { type TemplateManifest } from "@love-memory/template-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type GiftAccessor } from "@/modules/gifts/application/gift-service";

import {
  activeTrack,
  assetIds,
  completeContent,
  giftId,
  mediaAsset,
  memoryBoxManifest,
  retiredMemoryBoxManifest,
} from "../../viewer/test/viewer-fixtures";
import {
  createPreviewService,
  type PreviewServiceDependencies,
  type PreviewTokenRecord,
} from "./preview-service";
import { hashPreviewToken } from "./preview-token";

const owner: GiftAccessor = { kind: "user", userId: "user-1" };
const stranger: GiftAccessor = { kind: "user", userId: "user-2" };
const token = "A-_b".repeat(10) + "xyz";
const issuedAt = new Date("2026-10-01T10:00:00.000Z");

function draftGift(overrides: Partial<Gift> = {}): Gift {
  return {
    access: { mode: "unlisted" },
    content: {
      data: { "receiver-name": "An" },
      schemaVersion: 1,
      templateId: "memory-box",
      templateVersion: "1.1.0",
    },
    createdAt: issuedAt,
    id: giftId,
    ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-1" },
    publicId: "q1w2e3r4t5y6u7i8",
    revision: 3,
    status: "draft",
    updatedAt: issuedAt,
    ...overrides,
  };
}

describe("preview service", () => {
  let now: Date;
  let gift: Gift | null;
  let manifests: Map<string, TemplateManifest>;
  let records: PreviewTokenRecord[];
  let dependencies: PreviewServiceDependencies;
  let findActive: ReturnType<typeof vi.fn<PreviewServiceDependencies["tokens"]["findActive"]>>;

  beforeEach(() => {
    now = issuedAt;
    gift = draftGift();
    records = [];
    manifests = new Map([
      ["memory-box@1.1.0", memoryBoxManifest],
      ["memory-box@1.0.0", retiredMemoryBoxManifest],
    ]);
    findActive = vi.fn((tokenHash: string, at: Date) => {
      const record = records.find(
        (candidate) => candidate.tokenHash === tokenHash && candidate.expiresAt > at,
      );
      return Promise.resolve(
        record ? { expiresAt: record.expiresAt, giftId: record.giftId } : null,
      );
    });
    dependencies = {
      assets: {
        listByGiftId: (id) =>
          Promise.resolve(
            id === giftId ? assetIds.slice(0, 3).map((asset) => mediaAsset(asset)) : [],
          ),
      },
      clock: () => now,
      generateToken: () => token,
      gifts: {
        findAuthorized: (publicId, accessors) =>
          Promise.resolve(
            gift?.publicId === publicId &&
              accessors.some((accessor) => accessor.kind === "user" && accessor.userId === "user-1")
              ? gift
              : null,
          ),
        findDraftById: (id) =>
          Promise.resolve(gift?.id === id && gift.status === "draft" ? gift : null),
      },
      payload: {
        clock: () => now,
        downloadUrlTtlSeconds: 300,
        findSelectableTrack: (id) => (id === activeTrack.id ? activeTrack : null),
        resolveArtifact: (id, version) =>
          id === "memory-box" && version === "1.1.0" ? { contentHash: "f".repeat(64) } : null,
        signDownloadUrl: (key) => Promise.resolve(`https://blob.example/${key}?sig=1`),
      },
      templates: {
        findEditableManifest: (templateId, version) =>
          Promise.resolve(manifests.get(`${templateId}@${version}`) ?? null),
      },
      tokens: {
        findActive,
        insert: (record) => {
          records.push(record);
          return Promise.resolve();
        },
      },
    };
  });

  describe("issuing a preview link", () => {
    it("gives the owner a 30-minute link and stores only the token hash", async () => {
      const result = await createPreviewService(dependencies).createPreviewLink({
        accessors: [owner],
        publicId: "q1w2e3r4t5y6u7i8",
      });

      expect(result).toEqual({
        data: { expiresAt: "2026-10-01T10:30:00.000Z", url: `/preview/${token}` },
        ok: true,
      });
      expect(records).toEqual([
        {
          createdAt: issuedAt,
          expiresAt: new Date("2026-10-01T10:30:00.000Z"),
          giftId,
          tokenHash: hashPreviewToken(token),
        },
      ]);
      expect(JSON.stringify(records)).not.toContain(token);
    });

    it("uses a fresh random token when none is injected", async () => {
      const { generateToken: _ignored, ...rest } = dependencies;
      const result = await createPreviewService(rest).createPreviewLink({
        accessors: [owner],
        publicId: "q1w2e3r4t5y6u7i8",
      });

      expect(result.ok && result.data.url).toMatch(/^\/preview\/[A-Za-z0-9_-]{43}$/);
    });

    it("denies a non-owner opaquely and creates no token", async () => {
      const service = createPreviewService(dependencies);

      await expect(
        service.createPreviewLink({ accessors: [stranger], publicId: "q1w2e3r4t5y6u7i8" }),
      ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
      await expect(
        service.createPreviewLink({ accessors: [owner], publicId: "nonexistent-id-00" }),
      ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
      expect(records).toEqual([]);
    });

    it.each(["published", "deleted"] as const)("refuses a %s gift", async (status) => {
      gift = draftGift({ status });

      await expect(
        createPreviewService(dependencies).createPreviewLink({
          accessors: [owner],
          publicId: "q1w2e3r4t5y6u7i8",
        }),
      ).resolves.toEqual({ error: { code: "NOT_FOUND" }, ok: false });
      expect(records).toEqual([]);
    });

    it("reports an unresolved template version as an invalid state", async () => {
      manifests.clear();

      await expect(
        createPreviewService(dependencies).createPreviewLink({
          accessors: [owner],
          publicId: "q1w2e3r4t5y6u7i8",
        }),
      ).resolves.toEqual({ error: { code: "INVALID_STATE" }, ok: false });
      expect(records).toEqual([]);
    });
  });

  describe("opening a preview link", () => {
    async function issue() {
      const service = createPreviewService(dependencies);
      await service.createPreviewLink({ accessors: [owner], publicId: "q1w2e3r4t5y6u7i8" });
      return service;
    }

    it("shows the latest saved content, not a snapshot", async () => {
      const service = await issue();
      gift = draftGift({
        content: { ...gift!.content, data: completeContent() },
        revision: 4,
      });

      const opened = await service.openPreview(token);

      expect(opened?.publicId).toBe("q1w2e3r4t5y6u7i8");
      expect(opened?.viewer.payload).toEqual(completeContent());
      expect(opened?.viewer.artifactUrl).toBe(
        `/template-artifacts/memory-box/1.1.0/${"f".repeat(64)}/index.html`,
      );
      expect(Object.keys(opened?.viewer.assets ?? {})).toHaveLength(3);
      expect(opened?.viewer.issues).toEqual([]);
    });

    it("answers null without a database call for a malformed token", async () => {
      const service = await issue();

      await expect(service.openPreview("abc")).resolves.toBeNull();
      await expect(service.openPreview(`${token}=`)).resolves.toBeNull();
      expect(findActive).not.toHaveBeenCalled();
    });

    it("answers null for an unknown token", async () => {
      const service = await issue();

      await expect(service.openPreview("Z".repeat(43))).resolves.toBeNull();
      expect(findActive).toHaveBeenCalledExactlyOnceWith(hashPreviewToken("Z".repeat(43)), now);
    });

    it("answers null for an expired token even before TTL deletion", async () => {
      const service = await issue();
      now = new Date(issuedAt.getTime() + 1801 * 1000);

      await expect(service.openPreview(token)).resolves.toBeNull();
      expect(records).toHaveLength(1);
    });

    it("answers null once the gift is no longer a draft", async () => {
      const service = await issue();
      gift = draftGift({ status: "published" });

      await expect(service.openPreview(token)).resolves.toBeNull();
    });

    it("answers null when the template version can no longer be resolved", async () => {
      const service = await issue();
      manifests.clear();

      await expect(service.openPreview(token)).resolves.toBeNull();
    });

    it("renders a draft pinned to memory-box 1.0.0 without an artifact or an error", async () => {
      gift = draftGift({
        content: { ...draftGift().content, data: completeContent(), templateVersion: "1.0.0" },
      });
      const service = await issue();

      const opened = await service.openPreview(token);

      expect(opened?.viewer.artifactUrl).toBeNull();
      expect(opened?.viewer.payload).toEqual(completeContent());
      expect(Object.keys(opened?.viewer.assets ?? {})).toHaveLength(3);
    });
  });

  describe("edit rights", () => {
    it("lets only the draft's credentials edit it", async () => {
      const service = createPreviewService(dependencies);

      await expect(
        service.canEditDraft({ accessors: [owner], publicId: "q1w2e3r4t5y6u7i8" }),
      ).resolves.toBe(true);
      await expect(
        service.canEditDraft({ accessors: [stranger], publicId: "q1w2e3r4t5y6u7i8" }),
      ).resolves.toBe(false);
      await expect(
        service.canEditDraft({ accessors: [], publicId: "q1w2e3r4t5y6u7i8" }),
      ).resolves.toBe(false);
      gift = draftGift({ status: "published" });
      await expect(
        service.canEditDraft({ accessors: [owner], publicId: "q1w2e3r4t5y6u7i8" }),
      ).resolves.toBe(false);
    });
  });
});
