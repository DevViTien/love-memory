import { join } from "node:path";

import { createTemplatePayloadSchema, countImageItems } from "@love-memory/template-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareHtmlTemplate,
  type PreparedHtmlTemplate,
} from "../application/html-template-import";
import { readHtmlTemplateFolder, readLoveGiftBootstrap } from "./html-template-folder";

/**
 * `add-animation-gift-templates`: the five templates ported from `animation-gift`. For each one,
 * every field maps to a default of its type (the importer's check), a sample gift is valid content
 * that a Free plan (3 photos) can publish, and the embedded bootstrap turns it into the expected
 * `CONFIG` values, run in a jsdom frame with the template's own defaults.
 */

const repositoryRoot = join(__dirname, "../../../../../..");
const A = "550e8400-e29b-41d4-a716-446655440001";
const B = "550e8400-e29b-41d4-a716-446655440002";
const C = "550e8400-e29b-41d4-a716-446655440003";
const ASSETS = {
  [A]: "https://blob.test/a.jpg",
  [B]: "https://blob.test/b.jpg",
  [C]: "https://blob.test/c.jpg",
};
const FREE_PLAN_PHOTOS = 3;

function prepare(id: string): PreparedHtmlTemplate {
  return prepareHtmlTemplate(
    readHtmlTemplateFolder(join(repositoryRoot, "templates-html", id), readLoveGiftBootstrap()),
  );
}

function readPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);
}

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const iframe of frames.splice(0)) iframe.remove();
  vi.restoreAllMocks();
});

/** The `CONFIG` the bootstrap of `prepared` builds from its defaults and `payload`. */
async function configOf(
  prepared: PreparedHtmlTemplate,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const bootstrap = new TextDecoder().decode(
    prepared.files.find((file) => file.name === "love-gift.js")?.body,
  );
  const iframe = window.document.createElement("iframe");
  window.document.body.append(iframe);
  frames.push(iframe);
  const frameWindow = iframe.contentWindow as Window &
    typeof globalThis & { LoveGift: { config: () => Record<string, unknown> } };
  const posted: unknown[] = [];
  vi.spyOn(frameWindow.parent, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message);
  });
  frameWindow.document.open();
  frameWindow.document.write(
    `<!doctype html><html><head></head><body><script type="application/json" id="gift-config">${JSON.stringify(prepared.defaults)}</script><script>${bootstrap}</script></body></html>`,
  );
  frameWindow.document.close();
  await vi.waitFor(() => expect(frameWindow.document.readyState).toBe("complete"));

  const event = new frameWindow.MessageEvent("message", {
    data: {
      assets: ASSETS,
      context: { locale: "vi-VN", prefersReducedMotion: false },
      payload,
      protocolVersion: 1,
      type: "INIT",
    },
  });
  Object.defineProperty(event, "source", { value: frameWindow.parent });
  frameWindow.dispatchEvent(event);
  await vi.waitFor(() => expect(posted).toContainEqual({ protocolVersion: 1, type: "READY" }));
  return JSON.parse(JSON.stringify(frameWindow.LoveGift.config())) as Record<string, unknown>;
}

type Case = Readonly<{
  expected: Record<string, unknown>;
  id: string;
  name: string;
  payload: Record<string, unknown>;
}>;

const cases: readonly Case[] = [
  {
    expected: {
      autoOpenMs: 3500,
      cardTitle: ["Chúc mừng", "ngày 20/10"],
      letter: ["Gửi em,", "Anh thương em."],
      photo: ASSETS[A],
    },
    id: "envelope-letter",
    name: "Thư tay",
    payload: {
      audio: "acoustic-morning",
      "card-title": ["Chúc mừng", "ngày 20/10"],
      letter: ["  Gửi em,", "Anh thương em."],
      photo: A,
    },
  },
  {
    expected: {
      "colors.glow": "#8fc4ff",
      "colors.hearts": ["#ff3b4e", "#ff5a36", "#ff2f6d"],
      "colors.text": "#ffe9f0",
      gateTitle: "Gửi Minh Thư",
      heroTexts: ["Chúc mừng|sinh nhật", "♡ Minh Thư"],
      photos: [ASSETS[A], ASSETS[B]],
      texts: ["Tuổi mới thật vui", "Luôn xinh đẹp nhé", "Thương em"],
    },
    id: "galaxy-text",
    name: "Thông điệp giữa ngân hà",
    payload: {
      "gate-title": "Gửi Minh Thư",
      "hero-texts": ["Chúc mừng|sinh nhật", "♡ Minh Thư"],
      photos: [A, B],
      "text-color": "#ffe9f0",
      texts: ["Tuổi mới thật vui", "Luôn xinh đẹp nhé", "Thương em"],
    },
  },
  {
    expected: {
      caption: "Hai năm bên nhau",
      "colors.glow": "#d01ccf",
      "colors.heart": "#ff4f8b",
      messages: ["Chúc mừng|kỷ niệm", "Anh 💗 Em"],
      photoInterval: 5,
      photos: [ASSETS[A], ASSETS[B], ASSETS[C]],
    },
    id: "heart-photo",
    name: "Trái tim kỉ niệm",
    payload: {
      caption: "Hai năm bên nhau",
      "heart-color": "#ff4f8b",
      messages: ["Chúc mừng|kỷ niệm", "Anh 💗 Em"],
      photos: [A, B, C],
    },
  },
  {
    expected: {
      "colors.heart": "#ff6fd8",
      "colors.text": "#d6fff0",
      countdown: 3,
      heartText: "Mãi yêu em",
      messages: ["Chúc mừng|sinh nhật", "Minh Thư"],
      rainChars: "MINHTHU",
    },
    id: "matrix-text",
    name: "Lời nhắn ma trận",
    payload: {
      "heart-text": "Mãi yêu em",
      messages: ["Chúc mừng|sinh nhật", "Minh Thư"],
      "rain-chars": "MINHTHU",
      "text-color": "#d6fff0",
    },
  },
  {
    expected: {
      avatarHer: ASSETS[C],
      avatarHim: "",
      gallery: [
        { caption: "Biển", src: ASSETS[A] },
        { caption: "", src: ASSETS[B] },
      ],
      herName: "Minh Thư",
      himName: "Hoàng",
      "letter.paragraphs": ["Gửi Thư,", "Thương em."],
      "letter.title": "Lá thư tình yêu",
      "menu.0.id": "days",
      passcode: "1402",
      "popup.photo": "",
      startDate: "2024-02-14",
    },
    id: "memories",
    name: "Kỷ niệm của chúng mình",
    payload: {
      "avatar-her": C,
      gallery: [{ assetId: A, caption: " Biển " }, { assetId: B }],
      "her-name": "Minh Thư",
      "him-name": "Hoàng",
      "letter-paragraphs": ["Gửi Thư,", "Thương em."],
      passcode: "1402",
      "start-date": "2024-02-14",
    },
  },
];

describe.each(cases)("bundled html template $id", ({ expected, id, name, payload }) => {
  const prepared = prepare(id);

  it("is a published 1.0.0 html template with its thumbnail and bundled fonts", () => {
    expect(prepared.manifest).toMatchObject({ id, kind: "html", meta: { name }, version: "1.0.0" });
    const names = prepared.files.map((file) => file.name);
    expect(names).toEqual(expect.arrayContaining(["index.html", "love-gift.js", "script-1.js"]));
    expect(names).toContain("assets/thumbnail.jpg");
    expect(names.some((file) => /^assets\/fonts\/.+-vietnamese\.woff2$/.test(file))).toBe(true);
  });

  it("maps every field but audio to a default of its type", () => {
    for (const field of prepared.manifest.fields) {
      if (field.type === "audio") {
        expect(field.path).toBeUndefined();
        continue;
      }
      const value = readPath(prepared.defaults, field.path ?? "");
      if (field.type === "textList" || field.type === "imageList") {
        expect(Array.isArray(value), field.id).toBe(true);
      } else if (field.type === "captionedImageList") {
        expect(Array.isArray(value), field.id).toBe(true);
        for (const item of value as readonly Readonly<{ src?: unknown }>[]) {
          expect(typeof item.src, field.id).toBe("string");
        }
      } else {
        expect(typeof value, field.id).toBe("string");
      }
    }
  });

  it("accepts the sample gift as content a Free plan can publish", () => {
    expect(createTemplatePayloadSchema(prepared.manifest).safeParse(payload).success).toBe(true);
    expect(countImageItems(prepared.manifest, payload)).toBeLessThanOrEqual(FREE_PLAN_PHOTOS);
  });

  it("turns the sample gift into the template's CONFIG", async () => {
    const config = await configOf(prepared, payload);

    for (const [path, value] of Object.entries(expected)) {
      expect(readPath(config, path), path).toEqual(value);
    }
  });
});

describe("memories passcode", () => {
  it("defaults to no lock, so a gift without a passcode never asks for one", () => {
    expect(prepare("memories").defaults["passcode"]).toBe("");
  });
});
