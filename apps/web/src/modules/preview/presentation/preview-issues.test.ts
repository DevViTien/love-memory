import { describe, expect, it } from "vitest";

import { viewerFields } from "@/modules/viewer/test/viewer-fixtures";

import { describeIssue, mergePreviewIssues, UNKNOWN_FIELD_ISSUE_MESSAGE } from "./preview-issues";

const publicId = "q1w2e3r4t5y6u7i8";
const editable = { canEdit: true, publicId };
const field = (id: string) => viewerFields.find((candidate) => candidate.id === id)!;

describe("preview issues", () => {
  it("lists missing fields and a broken photo with Sửa links", () => {
    const items = mergePreviewIssues(
      viewerFields,
      [
        { code: "CONTENT_MISSING", fieldId: "receiver-name" },
        { code: "CONTENT_MISSING", fieldId: "opening-message" },
        { code: "CONTENT_TOO_FEW", fieldId: "memories" },
        { code: "CONTENT_MISSING", fieldId: "final-letter" },
      ],
      [{ code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 0 }],
      editable,
    );

    expect(items.map((item) => item.message)).toEqual([
      "Tên người nhận: chưa có nội dung.",
      "Lời mở hộp: chưa có nội dung.",
      "Ảnh kỷ niệm: cần ít nhất 3 ảnh.",
      "Ảnh kỷ niệm: ảnh 1 chưa sẵn sàng hoặc không tải được.",
      "Lá thư cuối: chưa có nội dung.",
    ]);
    expect(items[0]?.href).toBe(`/studio/${publicId}?field=receiver-name`);
    expect(items[3]?.href).toBe(`/studio/${publicId}?field=memories`);
  });

  it("lists an issue reported by both the server and the template once", () => {
    const issue = { code: "CONTENT_MISSING", fieldId: "final-letter" } as const;

    expect(mergePreviewIssues(viewerFields, [issue], [issue], editable)).toEqual([
      {
        href: `/studio/${publicId}?field=final-letter`,
        key: "CONTENT_MISSING|final-letter|",
        message: "Lá thư cuối: chưa có nội dung.",
      },
    ]);
  });

  it("returns nothing for a complete gift", () => {
    expect(mergePreviewIssues(viewerFields, [], [], editable)).toEqual([]);
  });

  it("chooses the message by code", () => {
    expect(describeIssue(field("memories"), { code: "CONTENT_TOO_FEW", fieldId: "memories" })).toBe(
      "Ảnh kỷ niệm: cần ít nhất 3 ảnh.",
    );
    expect(
      describeIssue(field("memories"), {
        code: "CONTENT_INVALID",
        fieldId: "memories",
        itemIndex: 2,
      }),
    ).toBe("Ảnh kỷ niệm: mục 3 chưa hợp lệ.");
    expect(describeIssue(field("audio"), { code: "CONTENT_INVALID", fieldId: "audio" })).toBe(
      "Nhạc nền có bản quyền: nội dung chưa hợp lệ.",
    );
    expect(
      describeIssue(field("memories"), {
        code: "ASSET_UNAVAILABLE",
        fieldId: "memories",
        itemIndex: 4,
      }),
    ).toBe("Ảnh kỷ niệm: ảnh 5 chưa sẵn sàng hoặc không tải được.");
    expect(
      describeIssue(field("memories"), { code: "ASSET_UNAVAILABLE", fieldId: "memories" }),
    ).toBe("Ảnh kỷ niệm: ảnh chưa sẵn sàng hoặc không tải được.");
    expect(
      describeIssue(
        { id: "photos", label: "Ảnh", required: true, type: "imageList" },
        { code: "CONTENT_TOO_FEW", fieldId: "photos" },
      ),
    ).toBe("Ảnh: cần ít nhất 1 ảnh.");
  });

  it("groups issues of unknown fields into one unlinked entry", () => {
    const items = mergePreviewIssues(
      viewerFields,
      [],
      [
        { code: "CONTENT_MISSING", fieldId: "ghost" },
        { code: "ASSET_UNAVAILABLE", fieldId: "phantom", itemIndex: 0 },
        { code: "CONTENT_MISSING", fieldId: "final-letter" },
      ],
      editable,
    );

    expect(items.map((item) => [item.message, item.href])).toEqual([
      ["Lá thư cuối: chưa có nội dung.", `/studio/${publicId}?field=final-letter`],
      [UNKNOWN_FIELD_ISSUE_MESSAGE, null],
    ]);
  });

  it("links nothing when this browser cannot edit the draft", () => {
    const items = mergePreviewIssues(
      viewerFields,
      [{ code: "CONTENT_MISSING", fieldId: "receiver-name" }],
      [],
      { canEdit: false, publicId },
    );

    expect(items).toEqual([
      {
        href: null,
        key: "CONTENT_MISSING|receiver-name|",
        message: "Tên người nhận: chưa có nội dung.",
      },
    ]);
  });
});
