import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MEMORY_BOX_DOCUMENT } from "../document";
import { completePayload, createHarness, initMessage, stageScene } from "../test/harness";
import { FINALE_PARTICLE_COUNT } from "./render";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("text rendering", () => {
  it("renders markup in gift text literally", () => {
    const harness = createHarness();
    const markup = "<img src=x onerror=alert(1)>";

    harness.send(
      initMessage(completePayload({ "opening-message": markup, "receiver-name": markup })),
    );
    harness.send({ type: "PLAY" });

    expect(document.querySelector("h1")?.textContent).toBe(`Gửi ${markup}`);
    expect(document.querySelector(".opening-message")?.textContent).toBe(markup);
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("keeps a single h1 and a meaningful reading order in every scene", () => {
    const harness = createHarness();
    harness.send(initMessage());
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    harness.send({ type: "PLAY" });

    const texts: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      expect(document.querySelectorAll("h1")).toHaveLength(1);
      texts.push(document.getElementById("app")?.textContent ?? "");
      harness.next();
    }
    expect(document.querySelectorAll("h1")).toHaveLength(1);

    expect(texts[0]).toBe("Gửi An15/09/2024Mở hộp nhé!Tiếp");
    expect(texts[1]).toBe("Gửi An15/09/2024Kỷ niệm 1/3Đà Lạt 2023 🌲Tiếp");
    expect(texts[3]).toBe("Gửi An15/09/2024Kỷ niệm 3/3Tiếp");
    expect(texts[4]).toBe("Gửi An15/09/2024Lá thưĐoạn một của lá thư.Đoạn hai của lá thư.Tiếp");
    expect(document.querySelector(".closing")?.tagName).toBe("H2");
  });

  it("renders the letter as a scrollable, focusable region of paragraphs", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000);

    const letter = document.querySelector<HTMLElement>("div.letter");
    expect(letter?.getAttribute("role")).toBe("region");
    expect(letter?.getAttribute("aria-label")).toBe("Lá thư");
    expect(letter?.tabIndex).toBe(0);
    expect([...(letter?.querySelectorAll("p") ?? [])].map((p) => p.textContent)).toEqual([
      "Đoạn một của lá thư.",
      "Đoạn hai của lá thư.",
    ]);
    expect(MEMORY_BOX_DOCUMENT).toMatch(/\.letter \{[^}]*overflow-y: auto[^}]*user-select: text/);
  });

  it("announces scenes politely and never creates audio or video elements", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000);
    harness.next();

    expect(document.getElementById("stage")?.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelectorAll("audio, video")).toHaveLength(0);
    expect(MEMORY_BOX_DOCUMENT).not.toMatch(/<(audio|video)\b/);
  });
});

describe("Tiếp control", () => {
  it("is a native button that advances from the keyboard and keeps focus", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();
    expect(stageScene()).toBe("memory-1");

    const button = document.querySelector<HTMLButtonElement>("button.next");
    expect(button?.type).toBe("button");
    button?.focus();
    await user.keyboard("{Enter}");

    expect(stageScene()).toBe("memory-2");
    expect(document.activeElement?.classList.contains("next")).toBe(true);
    harness.send({ type: "DESTROY" });
  });

  it("moves keyboard focus to the closing heading when Tiếp opens the finale", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const harness = createHarness();
    harness.send(initMessage(completePayload({ memories: [] }), { assets: {} }));
    harness.send({ type: "PLAY" });
    harness.next();
    expect(stageScene()).toBe("letter");

    document.querySelector<HTMLButtonElement>("button.next")?.focus();
    await user.keyboard("{Enter}");

    expect(stageScene()).toBe("finale");
    const closing = document.querySelector<HTMLElement>(".closing");
    expect(document.activeElement).toBe(closing);
    expect(closing?.tagName).toBe("H2");
    expect(closing?.getAttribute("tabindex")).toBe("-1");
    harness.send({ type: "DESTROY" });
  });

  it("does not steal focus into the finale when Tiếp was not focused", () => {
    const harness = createHarness();
    harness.send(initMessage(completePayload({ memories: [] }), { assets: {} }));
    harness.send({ type: "PLAY" });
    harness.next();
    harness.next();

    expect(stageScene()).toBe("finale");
    expect(document.activeElement).toBe(document.body);
  });

  it("gives the scrollable letter and the closing heading a visible focus indicator", () => {
    expect(MEMORY_BOX_DOCUMENT).toContain(
      ".letter:focus-visible, .closing:focus-visible { outline: 3px solid var(--mb-focus); outline-offset: 3px; }",
    );
  });

  it("keeps Tiếp on screen by fitting the 4:5 photo frame into the space left", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.next();

    const frame = document.querySelector(".memory-photo > .frame-slot > .frame");
    expect(frame?.querySelector("img.photo")).toBeTruthy();
    expect(frame?.parentElement?.nextElementSibling?.className).toBe("caption");
    expect(MEMORY_BOX_DOCUMENT).toContain(
      'body[data-state="playing"] #app, body[data-state="paused"] #app, body[data-state="complete"] #app { height: 100%; }',
    );
    expect(MEMORY_BOX_DOCUMENT).toMatch(
      /\.frame-slot \{[^}]*flex: 0 1 25rem;[^}]*container-type: size;/,
    );
    expect(MEMORY_BOX_DOCUMENT).toContain(
      ".frame-slot .frame { width: auto; height: min(100cqh, 125cqw, 25rem); }",
    );
  });

  it("declares a 44×44 target and a visible focus indicator", () => {
    expect(MEMORY_BOX_DOCUMENT).toMatch(/\.next \{[^}]*min-width: 6rem; min-height: 2\.75rem/);
    expect(MEMORY_BOX_DOCUMENT).toMatch(
      /\.next:focus-visible \{ outline: 3px solid var\(--mb-focus\)/,
    );
  });

  it("uses system fonts and wraps long words", () => {
    expect(MEMORY_BOX_DOCUMENT).toContain("font-family: system-ui");
    expect(MEMORY_BOX_DOCUMENT).not.toMatch(/@font-face|@import|url\(/);
    expect(MEMORY_BOX_DOCUMENT).toContain("overflow-wrap: anywhere");
  });
});

describe("motion", () => {
  function reachFinale(reducedMotion: boolean) {
    const harness = createHarness();
    harness.send(initMessage(completePayload(), { reducedMotion }));
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000);
    harness.next();
    return harness;
  }

  it("renders no particles and completes immediately under reduced motion", () => {
    const harness = reachFinale(true);

    expect(document.body.dataset["motion"]).toBe("reduced");
    expect(document.querySelectorAll(".particle")).toHaveLength(0);
    expect(harness.eventTypes().slice(-2)).toEqual(["SCENE", "COMPLETE"]);
  });

  it("renders at most 24 particles and completes after 1.2 s otherwise", () => {
    const harness = reachFinale(false);

    expect(document.body.dataset["motion"]).toBe("full");
    const particles = document.querySelectorAll(".particle");
    expect(particles.length).toBe(FINALE_PARTICLE_COUNT);
    expect(particles.length).toBeLessThanOrEqual(24);
    expect(particles[0]?.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(harness.eventTypes().at(-1)).toBe("SCENE");
    vi.advanceTimersByTime(1200);
    expect(harness.eventTypes().at(-1)).toBe("COMPLETE");
  });

  it("shows every letter paragraph at once under reduced motion", () => {
    const harness = createHarness();
    harness.send(initMessage(completePayload(), { reducedMotion: true }));
    harness.send({ type: "PLAY" });
    vi.advanceTimersByTime(5000 + 3 * 6000);

    expect(document.querySelectorAll(".letter p")).toHaveLength(2);
    const reducedRules = MEMORY_BOX_DOCUMENT.split("\n").filter((line) =>
      line.includes('body[data-motion="reduced"]'),
    );
    expect(reducedRules.length).toBeGreaterThan(0);
    expect(reducedRules.join("\n")).not.toMatch(/transform|mb-enter|mb-rise|mb-breathe/);
    for (const line of MEMORY_BOX_DOCUMENT.split("\n")) {
      if (/animation: mb-(breathe|enter)|transform: (scale|translateY)\(-?1/.test(line)) {
        expect(line).toContain('body[data-motion="full"]');
      }
    }
  });

  it("pauses CSS animations on PAUSE", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PLAY" });
    harness.send({ type: "PAUSE" });

    expect(document.body.dataset["state"]).toBe("paused");
    expect(document.body.dataset["paused"]).toBe("true");
    expect(MEMORY_BOX_DOCUMENT).toContain(
      "body[data-paused] *, body[data-paused] *::before, body[data-paused] *::after { animation-play-state: paused !important; }",
    );
    harness.send({ type: "PLAY" });
    expect(document.body.dataset["paused"]).toBeUndefined();
  });

  it("freezes the cover's breathing on PAUSE and starts the sequence on the next PLAY", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PAUSE" });

    expect(document.body.dataset["state"]).toBe("cover");
    expect(document.body.dataset["paused"]).toBe("true");
    expect(MEMORY_BOX_DOCUMENT).toContain(
      'body[data-motion="full"][data-state="cover"] .box { animation: mb-breathe',
    );
    vi.advanceTimersByTime(30_000);
    expect(harness.scenes()).toEqual([]);

    harness.send({ type: "PLAY" });
    expect(document.body.dataset["paused"]).toBeUndefined();
    expect(harness.scenes()).toEqual(["opening"]);
  });

  it("unfreezes the cover when a new INIT replaces the gift", () => {
    const harness = createHarness();
    harness.send(initMessage());
    harness.send({ type: "PAUSE" });
    harness.send(initMessage(completePayload({ "receiver-name": "Bình" })));

    expect(document.body.dataset["paused"]).toBeUndefined();
    expect(document.querySelector("h1")?.textContent).toBe("Gửi Bình");
  });

  it("freezes the settling finale on PAUSE after COMPLETE and unfreezes on PLAY", () => {
    const harness = reachFinale(false);
    vi.advanceTimersByTime(1200);
    expect(harness.eventTypes().at(-1)).toBe("COMPLETE");

    harness.send({ type: "PAUSE" });
    expect(document.body.dataset["paused"]).toBe("true");
    harness.send({ type: "PLAY" });
    expect(document.body.dataset["paused"]).toBeUndefined();
    expect(harness.eventTypes().filter((type) => type === "COMPLETE")).toHaveLength(1);
    expect(harness.scenes().at(-1)).toBe("finale");
  });
});
