import { describe, expect, it } from "vitest";

import {
  activeTrack,
  assetIds,
  completeContent,
  giftId,
  mediaAsset,
  memoryBoxManifest,
  otherGiftId,
  viewerFields,
} from "../test/viewer-fixtures";
import {
  collectContentIssues,
  issuesToFieldErrors,
  resolveImageReferences,
  toViewerFields,
} from "./content-issues";

const dependencies = {
  findSelectableTrack: (id: string) => (id === activeTrack.id ? activeTrack : null),
};

function readyAssets() {
  return assetIds.slice(0, 3).map((id) => mediaAsset(id));
}

function issuesFor(content: Record<string, unknown>, assets = readyAssets()) {
  return collectContentIssues(
    { assets, content, giftId, manifest: memoryBoxManifest },
    dependencies,
  );
}

describe("collectContentIssues", () => {
  it("finds no issue in complete content with ready assets", () => {
    expect(issuesFor(completeContent())).toEqual([]);
  });

  it("reports a missing required field and too few images", () => {
    const content = completeContent();
    delete content["receiver-name"];
    content["memories"] = (content["memories"] as unknown[]).slice(0, 2);

    expect(issuesFor(content)).toEqual([
      { code: "CONTENT_MISSING", fieldId: "receiver-name" },
      { code: "CONTENT_TOO_FEW", fieldId: "memories" },
    ]);
  });

  it("reports an asset that is not ready, of another gift or of another field", () => {
    const assets = [
      mediaAsset(assetIds[0], { status: "processing" }),
      mediaAsset(assetIds[1], { giftId: otherGiftId }),
      mediaAsset(assetIds[2], { fieldId: "cover" }),
    ];

    expect(issuesFor(completeContent(), assets)).toEqual([
      { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 0 },
      { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 1 },
      { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 2 },
    ]);
  });

  it("reports a withdrawn audio track as an invalid value", () => {
    expect(issuesFor({ ...completeContent(), audio: "old-piano" })).toEqual([
      { code: "CONTENT_INVALID", fieldId: "audio" },
    ]);
  });

  it("reports an invalid value of one list item with its index", () => {
    const content = completeContent();
    content["memories"] = [
      ...(content["memories"] as unknown[]).slice(0, 2),
      { assetId: assetIds[2], caption: "x".repeat(500) },
    ];

    expect(issuesFor(content)).toContainEqual({
      code: "CONTENT_INVALID",
      fieldId: "memories",
      itemIndex: 2,
    });
  });
});

describe("collectContentIssues fails closed", () => {
  it("reports an undeclared key on the first field instead of passing", () => {
    expect(issuesFor({ ...completeContent(), "not-a-field": "x" })).toEqual([
      { code: "CONTENT_INVALID", fieldId: "receiver-name" },
    ]);
  });

  it("keeps field issues without adding the fallback", () => {
    const content: Record<string, unknown> = { ...completeContent(), "not-a-field": "x" };
    delete content["receiver-name"];

    expect(issuesFor(content)).toEqual([{ code: "CONTENT_MISSING", fieldId: "receiver-name" }]);
  });
});

describe("resolveImageReferences", () => {
  it("returns the derivative to sign for each available reference", () => {
    const { available, unavailable } = resolveImageReferences({
      assets: [mediaAsset(assetIds[0]), mediaAsset(assetIds[1], { widths: [] })],
      content: completeContent(),
      giftId,
      manifest: memoryBoxManifest,
    });

    expect(available).toEqual([
      { assetId: assetIds[0], key: `private/assets/${assetIds[0]}/w768.webp` },
    ]);
    expect(unavailable).toEqual([
      { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 1 },
      { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 2 },
    ]);
  });
});

describe("issuesToFieldErrors", () => {
  it("keys errors by field or by field and item, with fixed messages", () => {
    expect(
      issuesToFieldErrors(
        [
          { code: "CONTENT_MISSING", fieldId: "receiver-name" },
          { code: "CONTENT_TOO_FEW", fieldId: "memories" },
          { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 2 },
          { code: "CONTENT_INVALID", fieldId: "audio" },
        ],
        viewerFields,
      ),
    ).toEqual({
      audio: "This value is not valid.",
      memories: "Add at least 3 images.",
      "memories.2": "This image is not ready.",
      "receiver-name": "This field is required.",
    });
  });

  it("keeps the first issue of a key and never includes gift text", () => {
    const content = completeContent();
    content["memories"] = [{ assetId: assetIds[0], caption: "Bí mật riêng" }];
    const fieldErrors = issuesToFieldErrors(
      [
        { code: "CONTENT_INVALID", fieldId: "memories", itemIndex: 0 },
        { code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 0 },
      ],
      viewerFields,
    );

    expect(fieldErrors).toEqual({ "memories.0": "This value is not valid." });
    expect(JSON.stringify(fieldErrors)).not.toContain("Bí mật riêng");
  });

  it("falls back to one image when the field declares no minimum", () => {
    expect(
      issuesToFieldErrors([{ code: "CONTENT_TOO_FEW", fieldId: "unknown" }], viewerFields),
    ).toEqual({ unknown: "Add at least 1 images." });
  });
});

describe("toViewerFields", () => {
  it("describes every field without content", () => {
    expect(toViewerFields(memoryBoxManifest)).toEqual(viewerFields);
  });
});
