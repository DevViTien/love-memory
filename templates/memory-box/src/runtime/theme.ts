export const THEME_IDS = ["rose-night", "warm-paper"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemeTokens = Readonly<{
  /** Page background. */
  background: string;
  /** Decorative box body and lid; never carry information. */
  box: string;
  lid: string;
  /** Focus indicator (≥ 3:1 against background and surface). */
  focus: string;
  /** Secondary text such as the date and captions (≥ 4.5:1). */
  muted: string;
  /** `Tiếp` button fill (≥ 3:1 against background) and its label color (≥ 4.5:1 on it). */
  accent: string;
  onAccent: string;
  /** Cards and the letter panel. */
  surface: string;
  /** Body text (≥ 4.5:1 against background and surface). */
  text: string;
}>;

export const THEMES: Readonly<Record<ThemeId, ThemeTokens>> = Object.freeze({
  "rose-night": {
    accent: "#fb7185",
    background: "#1c0f1d",
    box: "#e11d48",
    focus: "#fde68a",
    lid: "#fda4af",
    muted: "#f5c6d0",
    onAccent: "#2a0a14",
    surface: "#2c1a2c",
    text: "#fff4f6",
  },
  "warm-paper": {
    accent: "#9f1239",
    background: "#fbf4e8",
    box: "#e8a598",
    focus: "#1d4ed8",
    lid: "#c2410c",
    muted: "#6b4636",
    onAccent: "#fff7f8",
    surface: "#fffaf2",
    text: "#3a2317",
  },
});

/** The payload `theme`, or the first option (`rose-night`) when absent or unknown. */
export function resolveThemeId(value: unknown): ThemeId {
  return THEME_IDS.find((id) => id === value) ?? "rose-night";
}

const TOKEN_PROPERTIES: Readonly<Record<keyof ThemeTokens, string>> = {
  accent: "--mb-accent",
  background: "--mb-background",
  box: "--mb-box",
  focus: "--mb-focus",
  lid: "--mb-lid",
  muted: "--mb-muted",
  onAccent: "--mb-on-accent",
  surface: "--mb-surface",
  text: "--mb-text",
};

/** Applies a palette as CSS variables and `data-theme` on the given element (the `<body>`). */
export function applyTheme(element: HTMLElement, themeId: ThemeId): void {
  const tokens = THEMES[themeId];
  for (const [token, property] of Object.entries(TOKEN_PROPERTIES)) {
    element.style.setProperty(property, tokens[token as keyof ThemeTokens]);
  }
  element.dataset["theme"] = themeId;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Expected a #rrggbb color, got ${hex}`);
  const [red, green, blue] = match.slice(1).map((part) => channel(Number.parseInt(part, 16)));
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}
