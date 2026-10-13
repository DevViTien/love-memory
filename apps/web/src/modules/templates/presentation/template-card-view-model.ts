import { type TemplateSummary } from "../domain/template-summary";

const visualByTemplateId: Readonly<Record<string, Readonly<{ gradient: string; icon: string }>>> = {
  "envelope-letter": {
    gradient: "from-rose-50 via-pink-100 to-rose-200",
    icon: "💌",
  },
  "galaxy-text": {
    gradient: "from-slate-950 via-indigo-950 to-rose-900",
    icon: "🌌",
  },
  "heart-photo": {
    gradient: "from-fuchsia-950 via-purple-900 to-pink-700",
    icon: "💖",
  },
  "love-days": {
    gradient: "from-rose-100 via-pink-100 to-rose-200",
    icon: "💞",
  },
  "matrix-text": {
    gradient: "from-stone-950 via-violet-950 to-indigo-800",
    icon: "💜",
  },
  memories: {
    gradient: "from-pink-100 via-rose-100 to-pink-200",
    icon: "📔",
  },
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

/** The badge of a template whose current version has no registered artifact yet. */
export const COMING_SOON_LABEL = "Sắp ra mắt";

export type TemplateCardViewModel = TemplateSummary &
  Readonly<{
    /** No registered artifact: shown with `Sắp ra mắt`, and no gift can be created from it. */
    comingSoon: boolean;
    durationLabel: string;
    gradient: string;
    icon: string;
    moodLabel: string;
    photoRequirement: string;
    /**
     * The template's own catalog picture (`html` templates with `assets/thumbnail.jpg`), shown
     * instead of the gradient and icon; `null` for a template without one or not yet available.
     */
    thumbnail: Readonly<{ alt: string; src: string }> | null;
  }>;

export function toTemplateCardViewModel(template: TemplateSummary): TemplateCardViewModel {
  const visual = visualByTemplateId[template.id] ?? fallbackVisual;
  const moodLabel = template.moods.map((mood) => moodLabels[mood] ?? mood).join(" · ");
  const range = template.imageRequirement;
  const photoRequirement = !range
    ? "Không bắt buộc"
    : range.minItems === range.maxItems
      ? `${range.minItems} ảnh`
      : `${range.minItems}–${range.maxItems} ảnh`;

  // A version without an artifact (or killed) cannot serve its files: keep the neutral visual.
  const thumbnail =
    template.available && template.thumbnailUrl
      ? { alt: `Hình minh họa mẫu quà ${template.name}`, src: template.thumbnailUrl }
      : null;

  return {
    ...template,
    comingSoon: !template.available,
    durationLabel: `Khoảng ${template.estimatedDurationSec} giây`,
    moodLabel,
    photoRequirement,
    thumbnail,
    ...visual,
  };
}
