import { describe, expect, it } from "vitest";

import { toTemplateCardViewModel } from "./template-card-view-model";

describe("template card view model", () => {
  it("maps domain metadata to localized presentation values", () => {
    const viewModel = toTemplateCardViewModel({
      description: "Story",
      estimatedDurationSec: 75,
      id: "memory-box",
      imageRequirement: { maxItems: 8, minItems: 3 },
      moods: ["warm", "playful"],
      name: "Memory Box",
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({
      durationLabel: "Khoảng 75 giây",
      icon: "🎁",
      moodLabel: "Ấm áp · Bất ngờ",
      photoRequirement: "3–8 ảnh",
    });
  });

  it("uses safe fallbacks for newly introduced templates", () => {
    const viewModel = toTemplateCardViewModel({
      description: "Story",
      estimatedDurationSec: 60,
      id: "new-template",
      moods: ["new-mood"],
      name: "New",
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({
      icon: "💝",
      moodLabel: "new-mood",
      photoRequirement: "Không bắt buộc",
    });
  });
});
