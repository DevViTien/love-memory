import { describe, expect, it } from "vitest";

import { type ViewerField } from "../application/viewer-payload";
import { assetIds, completeContent, viewerFields } from "../test/viewer-fixtures";
import { formatCalendarDate, toStaticGiftBlocks } from "./static-gift-content";

const assets = { [assetIds[0]]: "https://blob.example/signed/0" };

describe("static gift content", () => {
  it("renders fields with a value in declaration order, skipping theme and audio", () => {
    const blocks = toStaticGiftBlocks(viewerFields, completeContent(), assets);

    expect(blocks.map((block) => block.fieldId)).toEqual([
      "receiver-name",
      "anniversary-date",
      "opening-message",
      "memories",
      "final-letter",
    ]);
  });

  it("keeps long text line breaks and marks it multiline", () => {
    const blocks = toStaticGiftBlocks(viewerFields, completeContent(), assets);

    expect(blocks.find((block) => block.fieldId === "final-letter")).toEqual({
      fieldId: "final-letter",
      kind: "text",
      multiline: true,
      text: "Cảm ơn em\nvì tất cả.",
    });
  });

  it("formats a calendar date as DD/MM/YYYY without time-zone shifts", () => {
    expect(formatCalendarDate("2023-02-14")).toBe("14/02/2023");
    expect(formatCalendarDate("2024-01-01")).toBe("01/01/2024");
    expect(formatCalendarDate("2023-02-14T00:00:00Z")).toBeNull();
    expect(toStaticGiftBlocks(viewerFields, { "anniversary-date": "2023-12-31" }, {})).toEqual([
      { fieldId: "anniversary-date", kind: "text", multiline: false, text: "31/12/2023" },
    ]);
  });

  it("maps captioned items with and without a URL or caption", () => {
    const blocks = toStaticGiftBlocks(viewerFields, completeContent(), assets);

    expect(blocks.find((block) => block.kind === "images")).toEqual({
      fieldId: "memories",
      items: [
        {
          assetId: assetIds[0],
          caption: "Đà Lạt 2023 🌲",
          fallbackText: "Đà Lạt 2023 🌲",
          index: 0,
          url: "https://blob.example/signed/0",
        },
        { assetId: assetIds[1], fallbackText: "Ảnh 2", index: 1 },
        { assetId: assetIds[2], caption: "Biển", fallbackText: "Biển", index: 2 },
      ],
      kind: "images",
    });
  });

  it("maps plain image lists", () => {
    const fields: ViewerField[] = [
      { id: "photos", label: "Ảnh", maxItems: 3, minItems: 1, required: true, type: "imageList" },
    ];

    expect(toStaticGiftBlocks(fields, { photos: [assetIds[0], 7, assetIds[1]] }, assets)).toEqual([
      {
        fieldId: "photos",
        items: [
          {
            assetId: assetIds[0],
            fallbackText: "Ảnh 1",
            index: 0,
            url: "https://blob.example/signed/0",
          },
          { assetId: assetIds[1], fallbackText: "Ảnh 3", index: 2 },
        ],
        kind: "images",
      },
    ]);
  });

  it("skips wrong-typed and empty values", () => {
    expect(
      toStaticGiftBlocks(
        viewerFields,
        {
          "anniversary-date": 20230214,
          "final-letter": ["not", "text"],
          memories: [{ caption: "no asset" }, "loose-id", null],
          "opening-message": "   ",
          "receiver-name": 42,
        },
        assets,
      ),
    ).toEqual([]);
    expect(toStaticGiftBlocks(viewerFields, { memories: "not a list" }, assets)).toEqual([]);
  });

  it("keeps markup as plain text data", () => {
    const markup = "<img src=x onerror=alert(1)>";

    expect(toStaticGiftBlocks(viewerFields, { "receiver-name": markup }, {})).toEqual([
      { fieldId: "receiver-name", kind: "text", multiline: false, text: markup },
    ]);
  });

  it("does not read inherited asset keys", () => {
    const blocks = toStaticGiftBlocks(viewerFields, { memories: [{ assetId: "toString" }] }, {});

    expect(blocks).toEqual([
      {
        fieldId: "memories",
        items: [{ assetId: "toString", fallbackText: "Ảnh 1", index: 0 }],
        kind: "images",
      },
    ]);
  });
});
