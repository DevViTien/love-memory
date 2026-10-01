import {
  parseTemplateManifest,
  parseTemplatePayload,
  resolveTemplateSteps,
} from "@love-memory/template-sdk";
import { describe, expect, it } from "vitest";

import rawManifest from "../template.manifest.json";
import previewFixture from "../preview.fixture.json";

const manifest = parseTemplateManifest(rawManifest);

function memory(index: number, caption?: string) {
  return {
    assetId: `550e8400-e29b-41d4-a716-${String(446655442000 + index).padStart(12, "0")}`,
    ...(caption === undefined ? {} : { caption }),
  };
}

describe("memory-box 1.1.0 manifest", () => {
  it("declares the release identity, budgets and field contract", () => {
    expect(manifest).toMatchObject({
      budgets: { initialJsKbGzip: 60, initialMediaKb: 0, maxTextureMb: 1 },
      capabilities: ["audio", "dom"],
      engineVersion: "1.0.0",
      entry: "index.html",
      id: "memory-box",
      meta: { name: "Hộp ký ức" },
      previewFixture: "preview.fixture.json",
      status: "published",
      version: "1.1.0",
    });
    expect(manifest.fields.map((field) => [field.id, field.type, field.required])).toEqual([
      ["receiver-name", "shortText", true],
      ["anniversary-date", "date", false],
      ["opening-message", "shortText", true],
      ["memories", "captionedImageList", true],
      ["final-letter", "longText", true],
      ["theme", "theme", false],
      ["audio", "audio", false],
    ]);
  });

  it("resolves to the storyboard steps with every field in exactly one step", () => {
    const steps = resolveTemplateSteps(manifest);

    expect(steps.map((step) => step.id)).toEqual([
      "recipient",
      "opening",
      "memories",
      "letter",
      "style",
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "Người nhận",
      "Lời mở hộp",
      "Kỷ niệm",
      "Lá thư",
      "Giao diện & nhạc",
    ]);
    const assigned = steps.flatMap((step) => step.fieldIds);
    expect([...assigned].sort()).toEqual(manifest.fields.map((field) => field.id).sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("accepts the preview fixture as a complete payload", () => {
    expect(() => parseTemplatePayload(manifest, previewFixture)).not.toThrow();
    expect(previewFixture.memories).toHaveLength(5);
    expect(previewFixture).not.toHaveProperty("audio");
    expect(previewFixture.memories.filter((item) => !("caption" in item))).toHaveLength(1);
  });

  it.each([
    ["2 memories", { memories: [memory(1), memory(2)] }],
    ["9 memories", { memories: Array.from({ length: 9 }, (_, index) => memory(index)) }],
    [
      "a caption of 141 characters",
      { memories: [memory(1, "a".repeat(141)), memory(2), memory(3)] },
    ],
    ["the theme ocean", { theme: "ocean" }],
  ])("rejects a payload outside the contract: %s", (_case, override) => {
    expect(() => parseTemplatePayload(manifest, { ...previewFixture, ...override })).toThrow();
  });
});
