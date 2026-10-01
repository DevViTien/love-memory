import { receiverHeading, renderFatal, renderStaticFallback } from "./fallback";
import { splitParagraphs } from "./format";
import type { MemoryBoxContent } from "./payload";
import type { Scene } from "./scenes";
import { applyTheme, type ThemeId } from "./theme";

/** At most 24 DOM particles in the finale (storyboard motion tokens). */
export const FINALE_PARTICLE_COUNT = 18;

export type BodyState =
  "complete" | "cover" | "destroyed" | "failed" | "loading" | "paused" | "playing";

export type SceneRenderOptions = Readonly<{
  /** The preloaded photo element of a memory scene; absent means a text card. */
  image?: HTMLImageElement;
  memoryCount: number;
  paused: boolean;
  reducedMotion: boolean;
}>;

export type MemoryBoxView = Readonly<{
  clear: () => void;
  renderCover: (content: MemoryBoxContent) => void;
  renderFallback: (content: MemoryBoxContent | undefined) => void;
  renderFatal: () => void;
  renderLoading: () => void;
  renderScene: (scene: Scene, content: MemoryBoxContent, options: SceneRenderOptions) => void;
  setMotion: (reducedMotion: boolean) => void;
  setPaused: (paused: boolean) => void;
  setState: (state: BodyState) => void;
  setTheme: (theme: ThemeId) => void;
}>;

type ElementOptions = Readonly<{
  attributes?: Readonly<Record<string, string>>;
  className?: string;
  text?: string;
}>;

/**
 * Builds the template DOM with `createElement` and `textContent` only: gift text is never parsed as
 * HTML. `onNext` is called when the recipient presses `Tiếp`.
 */
export function createDomView(document: Document, onNext: () => void): MemoryBoxView {
  const body = document.body;
  const app = document.getElementById("app") ?? body.appendChild(document.createElement("main"));
  app.id = "app";

  function element<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    { attributes = {}, className, text }: ElementOptions = {},
    children: readonly Node[] = [],
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  function masthead(content: MemoryBoxContent): HTMLElement {
    return element("header", { className: "masthead" }, [
      element("h1", { className: "title", text: receiverHeading(content) }),
      ...(content.date ? [element("p", { className: "date", text: content.date })] : []),
    ]);
  }

  function box(open: boolean): HTMLElement {
    return element(
      "div",
      { attributes: { "aria-hidden": "true" }, className: open ? "box open" : "box" },
      [element("div", { className: "lid" }), element("div", { className: "ribbon" })],
    );
  }

  function nextButton(paused: boolean): HTMLButtonElement {
    const button = element("button", {
      attributes: { type: "button" },
      className: "next",
      text: "Tiếp",
    });
    button.disabled = paused;
    button.addEventListener("click", () => onNext());
    return button;
  }

  function stage(): HTMLElement {
    const existing = document.getElementById("stage");
    if (existing && app.contains(existing)) return existing;
    return app.appendChild(
      element("div", { attributes: { "aria-live": "polite", id: "stage" }, className: "stage" }),
    );
  }

  function memoryFigure(scene: Scene, content: MemoryBoxContent, options: SceneRenderOptions) {
    const memory = content.memories[scene.memoryIndex ?? -1];
    const label = memory?.label ?? scene.id;
    if (options.image) {
      // The slot takes the height left after the caption and `Tiếp`; the 4:5 frame fits in it.
      return element("figure", { className: "memory memory-photo" }, [
        element("div", { className: "frame-slot" }, [
          element("div", { className: "frame" }, [options.image]),
        ]),
        ...(memory?.caption
          ? [element("figcaption", { className: "caption", text: memory.caption })]
          : []),
      ]);
    }
    return element("figure", { className: "memory" }, [
      element("div", { className: "frame text-card" }, [
        element("p", { className: "text-card-caption", text: memory?.caption ?? label }),
      ]),
    ]);
  }

  function sceneContent(
    scene: Scene,
    content: MemoryBoxContent,
    options: SceneRenderOptions,
  ): Node[] {
    switch (scene.kind) {
      case "opening":
        return [
          box(true),
          ...(content.openingMessage
            ? [element("p", { className: "opening-message", text: content.openingMessage })]
            : []),
        ];
      case "memory": {
        const position = (scene.memoryIndex ?? 0) + 1;
        return [
          element("p", {
            className: "eyebrow",
            text: `Kỷ niệm ${position}/${options.memoryCount}`,
          }),
          memoryFigure(scene, content, options),
        ];
      }
      case "letter": {
        const paragraphs = splitParagraphs(content.finalLetter ?? "").map((paragraph, index) =>
          element("p", { attributes: { style: `--i: ${Math.min(index, 8)}` }, text: paragraph }),
        );
        return [
          element("h2", { className: "letter-title", text: "Lá thư" }),
          element(
            "div",
            {
              attributes: { "aria-label": "Lá thư", role: "region", tabindex: "0" },
              className: "letter",
            },
            paragraphs,
          ),
        ];
      }
      case "finale": {
        const particles = options.reducedMotion
          ? []
          : [
              element(
                "div",
                { attributes: { "aria-hidden": "true" }, className: "particles" },
                Array.from({ length: FINALE_PARTICLE_COUNT }, (_, index) =>
                  element("span", {
                    attributes: {
                      style: `--x: ${(index * 37) % 100}%; --d: ${(index % 6) * 80}ms`,
                    },
                    className: "particle",
                    text: "♥",
                  }),
                ),
              ),
            ];
        return [
          ...particles,
          box(true),
          element("h2", {
            attributes: { tabindex: "-1" },
            className: "closing",
            text: "Cảm ơn vì đã mở hộp ký ức này",
          }),
          element("p", {
            className: "closing-note",
            text: "Những kỷ niệm đẹp nhất vẫn đang chờ phía trước ♥",
          }),
        ];
      }
    }
  }

  return {
    clear() {
      app.replaceChildren();
    },
    renderCover(content) {
      app.replaceChildren(masthead(content));
      stage().replaceChildren(
        element(
          "section",
          { attributes: { "data-scene": "cover" }, className: "scene scene-cover" },
          [box(false)],
        ),
      );
    },
    renderFallback(content) {
      renderStaticFallback(app, content);
    },
    renderFatal() {
      renderFatal(app);
    },
    renderLoading() {
      app.replaceChildren(
        element("p", {
          attributes: { role: "status" },
          className: "loading",
          text: "Đang mở món quà…",
        }),
      );
    },
    renderScene(scene, content, options) {
      const target = stage();
      const hadFocus =
        document.activeElement instanceof HTMLButtonElement &&
        target.contains(document.activeElement);
      const section = element(
        "section",
        { attributes: { "data-scene": scene.id }, className: `scene scene-${scene.kind}` },
        sceneContent(scene, content, options),
      );
      const button = scene.kind === "finale" ? undefined : nextButton(options.paused);
      if (button) section.append(button);
      target.replaceChildren(section);
      if (!hadFocus) return;
      // Keep keyboard focus in the scene: on `Tiếp`, or on the closing heading in the finale.
      const focusTarget = button ?? section.querySelector<HTMLElement>(".closing");
      focusTarget?.focus({ preventScroll: true });
    },
    setMotion(reducedMotion) {
      body.dataset["motion"] = reducedMotion ? "reduced" : "full";
    },
    setPaused(paused) {
      // Freezes CSS animations in every state (cover breathing, scene entry, finale particles).
      if (paused) body.dataset["paused"] = "true";
      else delete body.dataset["paused"];
      for (const button of app.querySelectorAll<HTMLButtonElement>("button.next")) {
        button.disabled = paused;
      }
    },
    setState(state) {
      body.dataset["state"] = state;
    },
    setTheme(theme) {
      applyTheme(body, theme);
    },
  };
}
