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
      available: true,
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({
      comingSoon: false,
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
      available: true,
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({
      icon: "💝",
      moodLabel: "new-mood",
      photoRequirement: "Không bắt buộc",
    });
  });

  it("marks a template without a registered artifact as coming soon", () => {
    const viewModel = toTemplateCardViewModel({
      available: false,
      description: "Story",
      estimatedDurationSec: 90,
      id: "midnight-wish",
      moods: ["dreamy"],
      name: "Bầu trời lời nhắn",
      version: "1.0.0",
    });

    expect(viewModel).toMatchObject({ comingSoon: true, icon: "✨" });
  });
});
