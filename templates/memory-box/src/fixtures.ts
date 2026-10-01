import type { MemoryBoxHarnessFixture } from "./index";
import previewFixture_1_1_0 from "../releases/1.1.0/preview.fixture.json";

type Shape = "3:2" | "3:4" | "4:5";

const SHAPES: Readonly<Record<Shape, readonly [number, number, string]>> = {
  "3:2": [300, 200, "ngang"],
  "3:4": [240, 320, "dọc"],
  "4:5": [240, 300, "dọc"],
};

const PALETTES = [
  ["#fb7185", "#7c3aed"],
  ["#f59e0b", "#be123c"],
  ["#34d399", "#1d4ed8"],
  ["#f472b6", "#0f766e"],
] as const;

/** A small deterministic SVG photo stand-in as an inline `data:` URL (never a storage URL). */
function svgPhoto(index: number, shape: Shape): string {
  const [width, height, orientation] = SHAPES[shape];
  const [from, to] = PALETTES[index % PALETTES.length] ?? PALETTES[0];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>` +
    `<stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<text x="50%" y="50%" fill="#fff" font-family="system-ui,sans-serif" font-size="22" ` +
    `text-anchor="middle">Ảnh ${index + 1} · ${orientation} ${shape}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function assetId(index: number): string {
  return `550e8400-e29b-41d4-a716-${String(446655443000 + index).padStart(12, "0")}`;
}

/** Repeats `pattern` to exactly `length` UTF-16 code units without splitting an emoji. */
function fill(pattern: string, length: number): string {
  let value = pattern.repeat(Math.ceil(length / pattern.length) + 1).slice(0, length);
  const last = value.charCodeAt(value.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) value = `${value.slice(0, -1)}.`;
  // Keep the exact length after the validator trims whitespace.
  return value.replace(/\s+$/, (whitespace) => ".".repeat(whitespace.length));
}

const shapeCycle: readonly Shape[] = ["4:5", "3:2", "3:4"];

const maxLengthMemories = Array.from({ length: 8 }, (_, index) => ({
  assetId: assetId(index),
  caption: fill(`Kỷ niệm số ${index + 1} ở Đà Lạt 🌲 những ngày mưa phùn dịu dàng; `, 140),
}));

const letterParagraph =
  "Cảm ơn em vì đã ở bên anh qua những ngày nắng và cả những ngày giông bão 💌. " +
  "Siêudàikhôngcókhoảngtrắngđểkiểmtraviệcxuốngdòngtrongkhunghẹp ";

type PreviewFixture = MemoryBoxHarnessFixture["payload"] &
  Readonly<{ memories: ReadonlyArray<Readonly<{ assetId: string }>> }>;

/** The `default` fixture: a release's own preview fixture with a photo for each memory. */
function defaultFixture(previewFixture: PreviewFixture): MemoryBoxHarnessFixture {
  return {
    assets: Object.fromEntries(
      previewFixture.memories.map((memory, index) => [
        memory.assetId,
        svgPhoto(index, shapeCycle[index % shapeCycle.length] ?? "4:5"),
      ]),
    ),
    payload: previewFixture,
  };
}

/** Harness fixtures for `memory-box@1.1.0`, validated against that release's manifest. */
const FIXTURES_1_1_0: Readonly<Record<string, MemoryBoxHarnessFixture>> = {
  default: defaultFixture(previewFixture_1_1_0),
  "max-length": {
    assets: Object.fromEntries(
      maxLengthMemories.map((memory, index) => [
        memory.assetId,
        svgPhoto(index, shapeCycle[index % shapeCycle.length] ?? "4:5"),
      ]),
    ),
    payload: {
      "anniversary-date": "2024-02-29",
      "final-letter": fill(`${letterParagraph}\n\n`, 1200),
      memories: maxLengthMemories,
      "opening-message": fill("Chiếc hộp nhỏ này chứa đầy những điều dễ thương nhất 🎁 ", 120),
      "receiver-name": fill("Nguyễn Thị Ánh Tuyết 💖 ", 40),
      theme: "warm-paper",
    },
  },
  "missing-fields": { assets: {}, payload: {} },
  "broken-image": {
    assets: {
      [assetId(0)]: svgPhoto(0, "4:5"),
      [assetId(2)]: "data:image/png;base64,AAAA",
      [assetId(3)]: svgPhoto(3, "3:2"),
    },
    payload: {
      "final-letter": "Có vài tấm ảnh bị lỗi, nhưng lời nhắn vẫn còn nguyên.",
      memories: [
        { assetId: assetId(0), caption: "Ảnh hiển thị bình thường" },
        { assetId: assetId(1), caption: "Ảnh không có đường dẫn" },
        { assetId: assetId(2), caption: "Ảnh không giải mã được" },
        { assetId: assetId(3) },
      ],
      "opening-message": "Mở hộp nào!",
      "receiver-name": "Bình",
    },
  },
};

/**
 * Viewer harness fixtures keyed by release version, then by fixture name. Each release has its own
 * set, so a later version with different fields never shows fixtures written for another manifest.
 */
export const MEMORY_BOX_HARNESS_FIXTURES: Readonly<
  Record<string, Readonly<Record<string, MemoryBoxHarnessFixture>>>
> = {
  "1.1.0": FIXTURES_1_1_0,
};
