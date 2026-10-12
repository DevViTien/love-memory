import { parseTemplateManifest } from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

import { toStaticGiftBlocks } from "../presentation/static-gift-content";
import { assetIds, giftId, mediaAsset } from "../test/viewer-fixtures";
import { collectContentIssues, issuesToFieldErrors, toViewerFields } from "./content-issues";

/** An `html` manifest with the four new field types (`viewer-payload`, `gift-viewer`). */
const manifest = parseTemplateManifest({
  budgets: { initialJsKbGzip: 12, initialMediaKb: 120, maxTextureMb: 8 },
  capabilities: ["dom"],
  engineVersion: "1.0.0",
  entry: "index.html",
  fields: [
    { id: "name", label: "Tên", maxLength: 30, path: "name", required: true, type: "shortText" },
    {
      id: "lines",
      itemMaxLength: 20,
      label: "Lời nhắn",
      maxItems: 4,
      minItems: 2,
      path: "lines",
      type: "textList",
    },
    { id: "photo", label: "Ảnh", path: "photo", required: true, type: "image" },
    { id: "avatar", label: "Ảnh đại diện", path: "avatar", type: "image" },
    { id: "pin", label: "Mã", length: 4, path: "pin", type: "passcode" },
    { id: "accent", label: "Màu", path: "accent", type: "color" },
  ],
  id: "html-fixture",
  kind: "html",
  meta: {
    description: "Fixture",
    estimatedDurationSec: 10,
    moods: ["warm"],
    name: "Fixture",
    occasions: ["anniversary"],
  },
  previewFixture: "index.html",
  status: "published",
  version: "1.0.0",
});

const [photoId, avatarId] = assetIds;
const dependencies = { findSelectableTrack: () => null };

function issuesFor(
  content: Record<string, unknown>,
  assets = [mediaAsset(photoId, { fieldId: "photo" })],
) {
  return collectContentIssues({ assets, content, giftId, manifest }, dependencies);
}

describe("viewer fields of the new types", () => {
  it("describes list and image ranges without content", () => {
    expect(toViewerFields(manifest)).toEqual([
      { id: "name", label: "Tên", required: true, type: "shortText" },
      {
        id: "lines",
        label: "Lời nhắn",
        maxItems: 4,
        minItems: 2,
        required: false,
        type: "textList",
      },
      { id: "photo", label: "Ảnh", maxItems: 1, minItems: 1, required: true, type: "image" },
      {
        id: "avatar",
        label: "Ảnh đại diện",
        maxItems: 1,
        minItems: 0,
        required: false,
        type: "image",
      },
      { id: "pin", label: "Mã", required: false, type: "passcode" },
      { id: "accent", label: "Màu", required: false, type: "color" },
    ]);
  });
});

describe("content issues of the new types", () => {
  it("finds no issue in complete content with its photo ready", () => {
    expect(
      issuesFor({
        accent: "#ff3366",
        lines: ["Một", "Hai"],
        name: "Hana",
        photo: photoId,
        pin: "0420",
      }),
    ).toEqual([]);
  });

  it("reports a missing photo, too few lines, invalid values and an unavailable photo", () => {
    expect(issuesFor({ lines: ["Một"], name: "Hana" })).toEqual([
      { code: "CONTENT_TOO_FEW", fieldId: "lines" },
      { code: "CONTENT_MISSING", fieldId: "photo" },
    ]);
    expect(
      issuesFor({ accent: "red", lines: ["Một", ""], name: "Hana", photo: photoId, pin: "12" }),
    ).toEqual([
      { code: "CONTENT_INVALID", fieldId: "lines", itemIndex: 1 },
      { code: "CONTENT_INVALID", fieldId: "pin" },
      { code: "CONTENT_INVALID", fieldId: "accent" },
    ]);
    expect(
      issuesFor({ avatar: avatarId, lines: ["a", "b"], name: "Hana", photo: photoId }),
    ).toEqual([{ code: "ASSET_UNAVAILABLE", fieldId: "avatar", itemIndex: 0 }]);
  });

  it("does not accept a photo uploaded for another image field", () => {
    expect(
      issuesFor({ avatar: photoId, lines: ["a", "b"], name: "Hana", photo: photoId }),
    ).toContainEqual({ code: "ASSET_UNAVAILABLE", fieldId: "avatar", itemIndex: 0 });
  });

  it("names lines, not images, in the too-few message", () => {
    expect(
      issuesToFieldErrors(
        [{ code: "CONTENT_TOO_FEW", fieldId: "lines" }],
        toViewerFields(manifest),
      ),
    ).toEqual({ lines: "Add at least 2 items." });
  });
});

describe("static fallback of the new types", () => {
  it("shows text lists as lines and a single photo, never the passcode or the color", () => {
    const blocks = toStaticGiftBlocks(
      toViewerFields(manifest),
      {
        accent: "#ff3366",
        avatar: avatarId,
        lines: ["Một", "  ", 3, "Hai"],
        name: "Hana",
        photo: photoId,
        pin: "0420",
      },
      { [photoId]: "https://blob.example/photo" },
    );

    expect(blocks).toEqual([
      { fieldId: "name", kind: "text", multiline: false, text: "Hana" },
      { fieldId: "lines", kind: "text", multiline: true, text: "Một\nHai" },
      {
        fieldId: "photo",
        items: [
          { assetId: photoId, fallbackText: "Ảnh 1", index: 0, url: "https://blob.example/photo" },
        ],
        kind: "images",
      },
      {
        fieldId: "avatar",
        items: [{ assetId: avatarId, fallbackText: "Ảnh 1", index: 0 }],
        kind: "images",
      },
    ]);
  });

  it("skips empty and wrong-typed values", () => {
    expect(
      toStaticGiftBlocks(toViewerFields(manifest), { lines: "Một", photo: 7, pin: 1234 }, {}),
    ).toEqual([]);
    expect(toStaticGiftBlocks(toViewerFields(manifest), { lines: [" "] }, {})).toEqual([]);
  });
});
