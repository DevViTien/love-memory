import { type TemplateSummary } from "../domain/template-summary";

const visualByTemplateId: Readonly<Record<string, Readonly<{ gradient: string; icon: string }>>> = {
  "memory-box": {
    gradient: "from-rose-200 via-orange-100 to-amber-100",
    icon: "🎁",
  },
  "midnight-wish": {
    gradient: "from-indigo-950 via-purple-900 to-rose-800",
    icon: "✨",
  },
  "our-timeline": {
    gradient: "from-amber-100 via-orange-100 to-rose-200",
    icon: "🛤️",
  },
};

const moodLabels: Readonly<Record<string, string>> = {
  dreamy: "Mơ màng",
  nostalgic: "Hoài niệm",
  playful: "Bất ngờ",
  romantic: "Lãng mạn",
  warm: "Ấm áp",
};

const fallbackVisual = {
  gradient: "from-stone-100 via-rose-50 to-orange-100",
  icon: "💝",
} as const;

export type TemplateCardViewModel = TemplateSummary &
  Readonly<{
    durationLabel: string;
    gradient: string;
    icon: string;
    moodLabel: string;
    photoRequirement: string;
  }>;

export function toTemplateCardViewModel(template: TemplateSummary): TemplateCardViewModel {
  const visual = visualByTemplateId[template.id] ?? fallbackVisual;
  const moodLabel = template.moods.map((mood) => moodLabels[mood] ?? mood).join(" · ");
  const photoRequirement = template.imageRequirement
    ? `${template.imageRequirement.minItems}–${template.imageRequirement.maxItems} ảnh`
    : "Không bắt buộc";

  return {
    ...template,
    durationLabel: `Khoảng ${template.estimatedDurationSec} giây`,
    moodLabel,
    photoRequirement,
    ...visual,
  };
}
