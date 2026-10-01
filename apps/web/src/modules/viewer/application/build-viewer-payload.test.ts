import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeTrack,
  assetIds,
  completeContent,
  giftId,
  mediaAsset,
  memoryBoxManifest,
  otherGiftId,
  retiredMemoryBoxManifest,
} from "../test/viewer-fixtures";
import {
  buildViewerPayload,
  type BuildViewerPayloadDependencies,
  selectViewerDerivative,
} from "./build-viewer-payload";
import { issueKey, orderIssues } from "./viewer-payload";

const contentHash = "f".repeat(64);
const signedAt = new Date("2026-10-01T10:00:00.000Z");

describe("buildViewerPayload", () => {
  let signDownloadUrl: ReturnType<typeof vi.fn<(key: string) => Promise<string>>>;
  let dependencies: BuildViewerPayloadDependencies;

  beforeEach(() => {
    let counter = 0;
    signDownloadUrl = vi.fn((key: string) => {
      counter += 1;
      return Promise.resolve(`https://blob.example/${key}?signature=${counter}`);
    });
    dependencies = {
      clock: () => signedAt,
      downloadUrlTtlSeconds: 300,
      findSelectableTrack: (id) => (id === activeTrack.id ? activeTrack : null),
      resolveArtifact: (id, version) =>
        id === "memory-box" && version === "1.1.0" ? { contentHash } : null,
      signDownloadUrl,
    };
  });

  function readyAssets() {
    return assetIds.slice(0, 3).map((id) => mediaAsset(id));
  }

  describe("one transformation", () => {
    it("returns the same shape for the same input, apart from signatures", async () => {
      const input = {
        assets: readyAssets(),
        content: completeContent(),
        giftId,
        manifest: memoryBoxManifest,
      };
      const first = await buildViewerPayload(input, dependencies);
      const second = await buildViewerPayload(input, dependencies);

      expect(Object.keys(first).sort()).toEqual([
        "artifactUrl",
        "assets",
        "assetsExpireAt",
        "audioUrl",
        "fields",
        "issues",
        "payload",
      ]);
      expect(second.artifactUrl).toBe(first.artifactUrl);
      expect(second.payload).toEqual(first.payload);
      expect(second.fields).toEqual(first.fields);
      expect(second.issues).toEqual(first.issues);
      expect(second.audioUrl).toBe(first.audioUrl);
      expect(Object.keys(second.assets).sort()).toEqual(Object.keys(first.assets).sort());
      expect(second.assets[assetIds[0]]).not.toBe(first.assets[assetIds[0]]);
    });

    it("leaks no object key, owner id or checksum", async () => {
      // A real signer returns an opaque URL; the keys only reach it as an argument.
      dependencies = {
        ...dependencies,
        signDownloadUrl: () => Promise.resolve("https://blob.example/opaque?sig=x"),
      };
      const result = await buildViewerPayload(
        { assets: readyAssets(), content: completeContent(), giftId, manifest: memoryBoxManifest },
        dependencies,
      );
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("private/assets/");
      expect(serialized).not.toContain("user-1");
      expect(serialized).not.toContain("c".repeat(64));
      expect(serialized).not.toContain("sourceKey");
    });
  });

  describe("artifact resolution", () => {
    it("points a current Memory Box draft at its content-addressed artifact", async () => {
      const result = await buildViewerPayload(
        { assets: [], content: {}, giftId, manifest: memoryBoxManifest },
        dependencies,
      );

      expect(result.artifactUrl).toBe(
        `/template-artifacts/memory-box/1.1.0/${contentHash}/index.html`,
      );
    });

    it("returns no artifact for a version without one, and never another version", async () => {
      const resolveArtifact = vi.fn(dependencies.resolveArtifact);
      const result = await buildViewerPayload(
        {
          assets: readyAssets(),
          content: completeContent(),
          giftId,
          manifest: retiredMemoryBoxManifest,
        },
        { ...dependencies, resolveArtifact },
      );

      expect(result.artifactUrl).toBeNull();
      expect(resolveArtifact).toHaveBeenCalledTimes(1);
      expect(resolveArtifact).toHaveBeenCalledWith("memory-box", "1.0.0");
      expect(result.payload).toEqual(completeContent());
      expect(Object.keys(result.assets)).toHaveLength(3);
      expect(result.fields).toHaveLength(7);
      expect(result.issues).toEqual([]);
    });

    it("uses the artifact when the pinned content hash matches", async () => {
      const result = await buildViewerPayload(
        {
          assets: [],
          content: {},
          expectedContentHash: contentHash,
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(result.artifactUrl).toBe(
        `/template-artifacts/memory-box/1.1.0/${contentHash}/index.html`,
      );
    });

    it("drops the artifact but keeps the rest when the pinned content hash differs", async () => {
      const result = await buildViewerPayload(
        {
          assets: readyAssets(),
          content: completeContent(),
          expectedContentHash: "0".repeat(64),
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(result.artifactUrl).toBeNull();
      expect(result.payload).toEqual(completeContent());
      expect(Object.keys(result.assets)).toHaveLength(3);
    });
  });

  describe("payload", () => {
    it("keeps captioned images unchanged", async () => {
      const memories = [
        { assetId: assetIds[0], caption: "Đà Lạt 2023 🌲" },
        { assetId: assetIds[1] },
      ];
      const result = await buildViewerPayload(
        { assets: readyAssets(), content: { memories }, giftId, manifest: memoryBoxManifest },
        dependencies,
      );

      expect(result.payload["memories"]).toStrictEqual(memories);
      expect(JSON.stringify(result.payload)).not.toContain("https://");
    });

    it("returns an incomplete draft as it is", async () => {
      const result = await buildViewerPayload(
        { assets: [], content: {}, giftId, manifest: memoryBoxManifest },
        dependencies,
      );

      expect(result.payload).toStrictEqual({});
    });
  });

  describe("asset URLs", () => {
    it("signs the 768-pixel derivative of a ready asset for 300 seconds", async () => {
      const result = await buildViewerPayload(
        {
          assets: [mediaAsset(assetIds[0])],
          content: { memories: [{ assetId: assetIds[0] }] },
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(signDownloadUrl).toHaveBeenCalledExactlyOnceWith(
        `private/assets/${assetIds[0]}/w768.webp`,
      );
      expect(result.assets[assetIds[0]]).toContain("w768.webp");
      expect(result.assetsExpireAt).toBe("2026-10-01T10:05:00.000Z");
    });

    it("derives the expiry from the signing lifetime it is given", async () => {
      const result = await buildViewerPayload(
        {
          assets: [mediaAsset(assetIds[0])],
          content: { memories: [{ assetId: assetIds[0] }] },
          giftId,
          manifest: memoryBoxManifest,
        },
        { ...dependencies, downloadUrlTtlSeconds: 600 },
      );

      expect(result.assetsExpireAt).toBe("2026-10-01T10:10:00.000Z");
    });

    it("signs the widest derivative of a small source image", async () => {
      await buildViewerPayload(
        {
          assets: [mediaAsset(assetIds[0], { widths: [320, 600] })],
          content: { memories: [{ assetId: assetIds[0] }] },
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(signDownloadUrl).toHaveBeenCalledExactlyOnceWith(
        `private/assets/${assetIds[0]}/w600.webp`,
      );
    });

    it("selects by real width, whatever the order", () => {
      const derivative = (width: number) => ({
        contentType: "image/webp" as const,
        height: width,
        key: `w${width}`,
        width,
      });

      expect(selectViewerDerivative([])).toBeNull();
      expect(
        selectViewerDerivative([derivative(1280), derivative(900), derivative(320)])?.key,
      ).toBe("w900");
      expect(selectViewerDerivative([derivative(320), derivative(600), derivative(500)])?.key).toBe(
        "w600",
      );
      expect(selectViewerDerivative([derivative(600), derivative(1280)])?.key).toBe("w1280");
    });

    it("leaves out an asset that is still processing and keeps its id in the payload", async () => {
      const content = { memories: [{ assetId: assetIds[0] }, { assetId: assetIds[1] }] };
      const result = await buildViewerPayload(
        {
          assets: [
            mediaAsset(assetIds[0]),
            mediaAsset(assetIds[1], { derivatives: [], status: "processing" }),
          ],
          content,
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(Object.keys(result.assets)).toEqual([assetIds[0]]);
      expect((result.payload["memories"] as { assetId: string }[])[1]?.assetId).toBe(assetIds[1]);
    });

    it("signs nothing for an asset of another gift or another field", async () => {
      const result = await buildViewerPayload(
        {
          assets: [
            mediaAsset(assetIds[0], { giftId: otherGiftId }),
            mediaAsset(assetIds[1], { fieldId: "other-photos" }),
          ],
          content: { memories: [{ assetId: assetIds[0] }, { assetId: assetIds[1] }] },
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(result.assets).toEqual({});
      expect(signDownloadUrl).not.toHaveBeenCalled();
      expect(result.issues).toEqual(
        expect.arrayContaining([
          { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 0 },
          { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 1 },
        ]),
      );
    });

    it("returns no URLs and no expiry when nothing is referenced", async () => {
      const result = await buildViewerPayload(
        {
          assets: readyAssets(),
          content: { "receiver-name": "An" },
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(result.assets).toEqual({});
      expect(result.assetsExpireAt).toBeNull();
    });

    it("propagates a signing failure", async () => {
      await expect(
        buildViewerPayload(
          {
            assets: readyAssets(),
            content: completeContent(),
            giftId,
            manifest: memoryBoxManifest,
          },
          { ...dependencies, signDownloadUrl: () => Promise.reject(new Error("storage down")) },
        ),
      ).rejects.toThrow("storage down");
    });
  });

  describe("audio URL", () => {
    it("resolves the selected active track", async () => {
      const result = await buildViewerPayload(
        { assets: [], content: { audio: "acoustic-morning" }, giftId, manifest: memoryBoxManifest },
        dependencies,
      );

      expect(result.audioUrl).toBe(activeTrack.url);
    });

    it("returns no audio without a value or with an empty catalog", async () => {
      const withoutValue = await buildViewerPayload(
        { assets: [], content: {}, giftId, manifest: memoryBoxManifest },
        dependencies,
      );
      const emptyCatalog = await buildViewerPayload(
        { assets: [], content: { audio: "acoustic-morning" }, giftId, manifest: memoryBoxManifest },
        { ...dependencies, findSelectableTrack: () => null },
      );

      expect(withoutValue.audioUrl).toBeNull();
      expect(emptyCatalog.audioUrl).toBeNull();
    });

    it("reports a withdrawn track as invalid content", async () => {
      const result = await buildViewerPayload(
        {
          assets: readyAssets(),
          content: { ...completeContent(), audio: "old-piano" },
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(result.audioUrl).toBeNull();
      expect(result.issues).toEqual([{ code: "CONTENT_INVALID", fieldId: "audio" }]);
    });

    it("returns no audio for a manifest without an audio field", async () => {
      const manifest = {
        ...memoryBoxManifest,
        fields: memoryBoxManifest.fields.filter((field) => field.type !== "audio"),
      };
      const result = await buildViewerPayload(
        { assets: [], content: {}, giftId, manifest },
        dependencies,
      );

      expect(result.audioUrl).toBeNull();
    });
  });

  it("summarizes the Memory Box fields in declaration order", async () => {
    const result = await buildViewerPayload(
      { assets: [], content: completeContent(), giftId, manifest: memoryBoxManifest },
      dependencies,
    );

    expect(result.fields.map((field) => field.id)).toEqual([
      "receiver-name",
      "anniversary-date",
      "opening-message",
      "memories",
      "final-letter",
      "theme",
      "audio",
    ]);
    expect(result.fields[3]).toEqual({
      id: "memories",
      label: "Ảnh kỷ niệm",
      maxItems: 8,
      minItems: 3,
      required: true,
      type: "captionedImageList",
    });
    expect(result.fields[0]).toEqual({
      id: "receiver-name",
      label: "Tên người nhận",
      required: true,
      type: "shortText",
    });
    expect(JSON.stringify(result.fields)).not.toContain("An");
  });

  describe("content issues", () => {
    it("reports every missing required field of an empty draft in order", async () => {
      const result = await buildViewerPayload(
        { assets: [], content: {}, giftId, manifest: memoryBoxManifest },
        dependencies,
      );

      expect(result.issues).toEqual([
        { code: "CONTENT_MISSING", fieldId: "receiver-name" },
        { code: "CONTENT_MISSING", fieldId: "opening-message" },
        { code: "CONTENT_MISSING", fieldId: "memories" },
        { code: "CONTENT_MISSING", fieldId: "final-letter" },
      ]);
    });

    it("reports too few photos and one still processing", async () => {
      const content = {
        ...completeContent(),
        memories: [{ assetId: assetIds[0] }, { assetId: assetIds[1] }],
      };
      const result = await buildViewerPayload(
        {
          assets: [
            mediaAsset(assetIds[0]),
            mediaAsset(assetIds[1], { derivatives: [], status: "processing" }),
          ],
          content,
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(result.issues).toEqual([
        { code: "CONTENT_TOO_FEW", fieldId: "memories" },
        { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 1 },
      ]);
    });

    it("reports an invalid item with its index", async () => {
      const content = completeContent();
      (content["memories"] as { assetId: string; caption?: string }[])[2]!.caption = "x".repeat(
        141,
      );
      const result = await buildViewerPayload(
        { assets: readyAssets(), content, giftId, manifest: memoryBoxManifest },
        dependencies,
      );

      expect(result.issues).toEqual([
        { code: "CONTENT_INVALID", fieldId: "memories", itemIndex: 2 },
      ]);
    });

    it("reports a field-level invalid value and drops unknown keys", async () => {
      const result = await buildViewerPayload(
        {
          assets: readyAssets(),
          content: { ...completeContent(), "anniversary-date": "14/02/2023", unknown: "x" },
          giftId,
          manifest: memoryBoxManifest,
        },
        dependencies,
      );

      expect(result.issues).toEqual([{ code: "CONTENT_INVALID", fieldId: "anniversary-date" }]);
    });

    it("reports nothing for a complete gift", async () => {
      const result = await buildViewerPayload(
        { assets: readyAssets(), content: completeContent(), giftId, manifest: memoryBoxManifest },
        dependencies,
      );

      expect(result.issues).toEqual([]);
    });
  });
});

describe("viewer issue helpers", () => {
  it("keys issues by code, field and item", () => {
    expect(issueKey({ code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 1 })).toBe(
      "ASSET_UNAVAILABLE|memories|1",
    );
    expect(issueKey({ code: "CONTENT_MISSING", fieldId: "memories" })).toBe(
      "CONTENT_MISSING|memories|",
    );
  });

  it("deduplicates, orders and drops unknown fields", () => {
    expect(
      orderIssues(
        ["a", "b"],
        [
          { code: "ASSET_UNAVAILABLE", fieldId: "b", itemIndex: 2 },
          { code: "CONTENT_MISSING", fieldId: "unknown" },
          { code: "ASSET_UNAVAILABLE", fieldId: "b", itemIndex: 0 },
          { code: "CONTENT_MISSING", fieldId: "a" },
          { code: "ASSET_UNAVAILABLE", fieldId: "b", itemIndex: 0 },
        ],
      ),
    ).toEqual([
      { code: "CONTENT_MISSING", fieldId: "a" },
      { code: "ASSET_UNAVAILABLE", fieldId: "b", itemIndex: 0 },
      { code: "ASSET_UNAVAILABLE", fieldId: "b", itemIndex: 2 },
    ]);
  });
});
