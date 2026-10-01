import { parseTemplateManifest } from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

import {
  DRAFT_MESSAGES,
  firstInvalidField,
  isDeepEqual,
  mapServerFieldErrors,
  normalizeFieldValue,
  stepCompletion,
  textCounter,
  validateDraftContent,
  withFieldValue,
} from "./draft-validation";
import { resolveStudioSteps } from "./studio-steps";
import { assetIds, steppedManifest } from "./test/fixtures";

const selectable = new Set(["acoustic-morning"]);
const steps = resolveStudioSteps(steppedManifest);

function field(id: string) {
  const found = steppedManifest.fields.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown field ${id}`);
  return found;
}

describe("normalizeFieldValue", () => {
  it("removes whitespace-only text and cleared values", () => {
    expect(normalizeFieldValue(field("final-letter"), "  \n\t ")).toBeUndefined();
    expect(normalizeFieldValue(field("final-letter"), " Anh nhớ em ")).toBe(" Anh nhớ em ");
    expect(normalizeFieldValue(field("anniversary-date"), "")).toBeUndefined();
    expect(normalizeFieldValue(field("theme"), "")).toBeUndefined();
    expect(normalizeFieldValue(field("audio"), "")).toBeUndefined();
    expect(normalizeFieldValue(field("memories"), [])).toBeUndefined();
    expect(normalizeFieldValue(field("memories"), "not a list")).toBeUndefined();
    expect(normalizeFieldValue(field("memories"), [{ assetId: assetIds[0] }])).toEqual([
      { assetId: assetIds[0] },
    ]);
  });

  it("sets or removes a field in a content copy", () => {
    const content = { "receiver-name": "Linh" };

    expect(withFieldValue(steppedManifest, content, "final-letter", "Thư")).toEqual({
      "final-letter": "Thư",
      "receiver-name": "Linh",
    });
    expect(withFieldValue(steppedManifest, content, "receiver-name", "   ")).toEqual({});
    expect(withFieldValue(steppedManifest, content, "unknown", "value")).toBe(content);
  });

  it("keeps the same content object for a change that changes nothing", () => {
    const content = { "receiver-name": "Linh" };

    expect(withFieldValue(steppedManifest, content, "receiver-name", "Linh")).toBe(content);
    expect(withFieldValue(steppedManifest, content, "final-letter", "   ")).toBe(content);
    expect(withFieldValue(steppedManifest, content, "receiver-name", "Lan")).not.toBe(content);
  });
});

describe("validateDraftContent", () => {
  it("accepts an incomplete draft and a draft with fewer images than the minimum", () => {
    expect(validateDraftContent(steppedManifest, {}, selectable)).toEqual({});
    expect(
      validateDraftContent(steppedManifest, { memories: [{ assetId: assetIds[0] }] }, selectable),
    ).toEqual({});
  });

  it("reports an unavailable audio track", () => {
    expect(validateDraftContent(steppedManifest, { audio: "old-piano" }, selectable)).toEqual({
      audio: DRAFT_MESSAGES.unavailableTrack,
    });
    expect(validateDraftContent(steppedManifest, { audio: "Not A Slug" }, selectable)).toEqual({
      audio: DRAFT_MESSAGES.unavailableTrack,
    });
    expect(
      validateDraftContent(steppedManifest, { audio: "acoustic-morning" }, selectable),
    ).toEqual({});
  });

  it("chooses Vietnamese messages by field type", () => {
    const errors = validateDraftContent(
      steppedManifest,
      {
        "anniversary-date": "31/12/2025",
        memories: Array.from({ length: 9 }, (_, index) => ({
          assetId: `550e8400-e29b-41d4-a716-44665544${String(index).padStart(4, "0")}`,
        })),
        "receiver-name": "x".repeat(41),
        theme: "neon",
      },
      selectable,
    );

    expect(errors).toEqual({
      "anniversary-date": DRAFT_MESSAGES.invalidDate,
      memories: "Tối đa 8 ảnh.",
      "receiver-name": DRAFT_MESSAGES.generic,
      theme: DRAFT_MESSAGES.unavailableTheme,
    });
  });

  it("uses the generic message for an invalid image item and ignores undeclared keys", () => {
    expect(
      validateDraftContent(
        steppedManifest,
        { memories: [{ assetId: "not-a-uuid" }], undeclared: true },
        selectable,
      ),
    ).toEqual({ memories: DRAFT_MESSAGES.generic });
  });
});

describe("stepCompletion", () => {
  const complete = {
    "final-letter": "Thư",
    memories: assetIds.map((assetId) => ({ assetId })),
    "opening-message": "Mở hộp nhé",
    "receiver-name": "Linh",
  };

  it("marks missing required fields and too few images as incomplete", () => {
    expect(stepCompletion(steppedManifest, steps, {}, {})).toEqual({
      letter: false,
      memories: false,
      opening: false,
      recipient: false,
      style: true,
    });
    expect(
      stepCompletion(
        steppedManifest,
        steps,
        { ...complete, memories: complete.memories.slice(0, 2) },
        {},
      ),
    ).toMatchObject({ letter: true, memories: false, opening: true, recipient: true });
  });

  it("treats a step with only optional empty fields as complete and honors client errors", () => {
    expect(stepCompletion(steppedManifest, steps, complete, {})).toEqual({
      letter: true,
      memories: true,
      opening: true,
      recipient: true,
      style: true,
    });
    expect(
      stepCompletion(steppedManifest, steps, complete, { audio: DRAFT_MESSAGES.unavailableTrack }),
    ).toMatchObject({ style: false });
  });
});

describe("firstInvalidField", () => {
  it("returns the first invalid field of the earliest step", () => {
    expect(
      firstInvalidField(steppedManifest, steps, {
        audio: DRAFT_MESSAGES.unavailableTrack,
        "final-letter": DRAFT_MESSAGES.generic,
      }),
    ).toEqual({ fieldId: "final-letter", label: "Lá thư" });
    expect(firstInvalidField(steppedManifest, steps, {})).toBeNull();
  });
});

describe("mapServerFieldErrors", () => {
  it("maps nested keys to their field and never shows server texts", () => {
    expect(mapServerFieldErrors(steppedManifest, { "memories.1.caption": "Too long" })).toEqual({
      byField: { memories: DRAFT_MESSAGES.generic },
      general: null,
    });
  });

  it("uses the general message for keys that name no field", () => {
    expect(mapServerFieldErrors(steppedManifest, { content: "Unrecognized key" })).toEqual({
      byField: {},
      general: DRAFT_MESSAGES.serverGeneral,
    });
  });

  it("maps a field literally named content to itself", () => {
    const manifest = parseTemplateManifest({
      ...steppedManifest,
      fields: [{ id: "content", label: "Nội dung chính", maxLength: 40, type: "shortText" }],
      steps: undefined,
    });

    expect(mapServerFieldErrors(manifest, { content: "Too long" })).toEqual({
      byField: { content: DRAFT_MESSAGES.generic },
      general: null,
    });
  });
});

describe("textCounter", () => {
  it("counts UTF-16 code units like the server", () => {
    expect(textCounter("Người thương", 40)).toBe("12/40");
    expect(textCounter("🌲", 40)).toBe("2/40");
  });
});

describe("isDeepEqual", () => {
  it("compares plain JSON values structurally", () => {
    expect(isDeepEqual({ a: [1, { b: "c" }] }, { a: [1, { b: "c" }] })).toBe(true);
    expect(isDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isDeepEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(isDeepEqual([1, 2], [2, 1])).toBe(false);
    expect(isDeepEqual([1], { 0: 1 })).toBe(false);
    expect(isDeepEqual(null, {})).toBe(false);
    expect(isDeepEqual("a", "a")).toBe(true);
  });
});
