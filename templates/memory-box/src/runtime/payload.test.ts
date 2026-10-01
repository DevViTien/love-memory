import { describe, expect, it } from "vitest";

import { ASSET_IDS, ASSET_URLS, completePayload } from "../test/harness";
import { boundText, formatCalendarDate, splitParagraphs } from "./format";
import { issueKey, normalizeInit } from "./payload";

describe("formatCalendarDate", () => {
  it("formats an ISO calendar date as DD/MM/YYYY without time zones", () => {
    expect(formatCalendarDate("2024-09-15")).toBe("15/09/2024");
    expect(formatCalendarDate("2024-02-29")).toBe("29/02/2024");
    expect(formatCalendarDate("2000-02-29")).toBe("29/02/2000");
  });

  it.each([
    "2023-02-29",
    "1900-02-29",
    "2024-13-01",
    "2024-00-10",
    "2024-04-31",
    "15/09/2024",
    20240915,
  ])("omits the invalid date %s", (value) => {
    expect(formatCalendarDate(value)).toBeUndefined();
  });
});

describe("boundText", () => {
  it("trims, bounds and never splits a surrogate pair", () => {
    expect(boundText("  An  ", 40)).toBe("An");
    expect(boundText("abcdef", 3)).toBe("abc");
    expect(boundText("ab🌲", 3)).toBe("ab");
    expect(boundText("   ", 3)).toBeUndefined();
    expect(boundText(42, 3)).toBeUndefined();
  });

  it("splits letters into paragraphs at blank lines", () => {
    expect(splitParagraphs("Một\nhai\n\n  Ba \r\n\r\nBốn\n\n\n")).toEqual([
      "Một\nhai",
      "Ba",
      "Bốn",
    ]);
  });
});

describe("normalizeInit", () => {
  it("normalizes a complete payload without issues", () => {
    const { content, issues } = normalizeInit(completePayload({ theme: "warm-paper" }), ASSET_URLS);

    expect(issues).toEqual([]);
    expect(content).toMatchObject({
      date: "15/09/2024",
      finalLetter: "Đoạn một của lá thư.\n\nĐoạn hai của lá thư.",
      openingMessage: "Mở hộp nhé!",
      receiverName: "An",
      theme: "warm-paper",
    });
    expect(content.memories).toEqual([
      { caption: "Đà Lạt 2023 🌲", index: 0, label: "Kỷ niệm 1", url: ASSET_URLS[ASSET_IDS[0]] },
      { caption: "Bữa tối đầu tiên", index: 1, label: "Kỷ niệm 2", url: ASSET_URLS[ASSET_IDS[1]] },
      { index: 2, label: "Kỷ niệm 3", url: ASSET_URLS[ASSET_IDS[2]] },
    ]);
  });

  it("reports every required field of an empty payload once, in field order", () => {
    const { content, issues } = normalizeInit({}, {});

    expect(issues).toEqual([
      { code: "CONTENT_MISSING", fieldId: "receiver-name" },
      { code: "CONTENT_MISSING", fieldId: "opening-message" },
      { code: "CONTENT_MISSING", fieldId: "memories" },
      { code: "CONTENT_MISSING", fieldId: "final-letter" },
    ]);
    expect(content).toEqual({ memories: [], theme: "rose-night" });
  });

  it("treats a value of the wrong type as missing", () => {
    const { content, issues } = normalizeInit(
      completePayload({ "final-letter": 42, "receiver-name": ["An"] }),
      ASSET_URLS,
    );

    expect(issues).toEqual([
      { code: "CONTENT_MISSING", fieldId: "receiver-name" },
      { code: "CONTENT_MISSING", fieldId: "final-letter" },
    ]);
    expect(content.finalLetter).toBeUndefined();
    expect(content.receiverName).toBeUndefined();
  });

  it("omits an invalid date, an unknown theme and audio without an issue", () => {
    const { content, issues } = normalizeInit(
      completePayload({ "anniversary-date": "2023-02-30", audio: 12, theme: "ocean" }),
      ASSET_URLS,
    );

    expect(issues).toEqual([]);
    expect(content.date).toBeUndefined();
    expect(content.theme).toBe("rose-night");
  });

  it("bounds text to the manifest limits and keeps at most 8 memories", () => {
    const memories = Array.from({ length: 10 }, (_, index) => ({
      assetId: ASSET_IDS[index % ASSET_IDS.length],
      caption: `${index} ${"c".repeat(200)}`,
    }));
    const { content } = normalizeInit(
      completePayload({
        "final-letter": "l".repeat(1300),
        memories,
        "opening-message": "o".repeat(130),
        "receiver-name": "n".repeat(50),
      }),
      ASSET_URLS,
    );

    expect(content.receiverName).toHaveLength(40);
    expect(content.openingMessage).toHaveLength(120);
    expect(content.finalLetter).toHaveLength(1200);
    expect(content.memories).toHaveLength(8);
    expect(content.memories.every((memory) => memory.caption?.length === 140)).toBe(true);
  });

  it("marks memories without a usable URL as unavailable", () => {
    const { content, issues } = normalizeInit(
      completePayload({
        memories: [
          { assetId: ASSET_IDS[0] },
          { assetId: ASSET_IDS[1], caption: "Không có ảnh" },
          { assetId: 7 },
          "not-an-item",
          { assetId: "toString" },
        ],
      }),
      { ...ASSET_URLS, [ASSET_IDS[1]]: "" },
    );

    expect(issues).toEqual(
      [1, 2, 3, 4].map((itemIndex) => ({
        code: "ASSET_UNAVAILABLE",
        fieldId: "memories",
        itemIndex,
      })),
    );
    expect(content.memories[1]).toEqual({ caption: "Không có ảnh", index: 1, label: "Kỷ niệm 2" });
    expect(content.memories[3]).toEqual({ index: 3, label: "Kỷ niệm 4" });
  });

  it("reports memories that are not a non-empty list as missing", () => {
    expect(normalizeInit(completePayload({ memories: [] }), ASSET_URLS).issues).toEqual([
      { code: "CONTENT_MISSING", fieldId: "memories" },
    ]);
    expect(normalizeInit(completePayload({ memories: "photo" }), ASSET_URLS).issues).toEqual([
      { code: "CONTENT_MISSING", fieldId: "memories" },
    ]);
  });

  it("keys issues by code, field and item index", () => {
    expect(issueKey({ code: "CONTENT_MISSING", fieldId: "memories" })).toBe(
      "CONTENT_MISSING|memories|",
    );
    expect(issueKey({ code: "ASSET_UNAVAILABLE", fieldId: "memories", itemIndex: 0 })).toBe(
      "ASSET_UNAVAILABLE|memories|0",
    );
  });
});
