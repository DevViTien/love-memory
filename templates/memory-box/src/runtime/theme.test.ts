import { describe, expect, it } from "vitest";

import { completePayload, createHarness, initMessage } from "../test/harness";
import { contrastRatio, resolveThemeId, THEME_IDS, THEMES } from "./theme";

function bodyToken(name: string): string {
  return document.body.style.getPropertyValue(name);
}

describe("themes", () => {
  it("applies the warm-paper palette", () => {
    const harness = createHarness();

    harness.send(initMessage(completePayload({ theme: "warm-paper" })));

    expect(document.body.dataset["theme"]).toBe("warm-paper");
    expect(bodyToken("--mb-background")).toBe(THEMES["warm-paper"].background);
    expect(bodyToken("--mb-text")).toBe(THEMES["warm-paper"].text);
  });

  it.each([["ocean"], [undefined]])(
    "falls back to rose-night for theme %s without an issue",
    (theme) => {
      const harness = createHarness();

      const payload: Record<string, unknown> = completePayload({ theme });
      if (theme === undefined) delete payload["theme"];
      harness.send(initMessage(payload));

      expect(document.body.dataset["theme"]).toBe("rose-night");
      expect(bodyToken("--mb-accent")).toBe(THEMES["rose-night"].accent);
      expect(harness.eventTypes()).toEqual(["READY"]);
      expect(resolveThemeId(theme)).toBe("rose-night");
    },
  );

  it.each(THEME_IDS)("meets the WCAG contrast requirements in %s", (id) => {
    const tokens = THEMES[id];

    for (const surface of [tokens.background, tokens.surface]) {
      expect(contrastRatio(tokens.text, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.muted, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.accent, surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens.focus, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio(tokens.onAccent, tokens.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.focus, tokens.accent)).toBeGreaterThanOrEqual(1);
  });

  it("computes WCAG ratios and rejects unknown color formats", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(() => contrastRatio("red", "#ffffff")).toThrow("Expected a #rrggbb color");
  });
});
