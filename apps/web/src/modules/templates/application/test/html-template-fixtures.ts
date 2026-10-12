import { type HtmlTemplateSource } from "../html-template-import";

/** A tiny PNG signature followed by filler: enough for the importer's signature check. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
export const WOFF2_BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]);

/** A bootstrap stand-in with the field marker the importer replaces. */
export const TEST_BOOTSTRAP = "window.FIELDS = /* love-gift:fields */ [];\n";

export const TEST_MANIFEST = {
  budgets: { initialJsKbGzip: 10, initialMediaKb: 50, maxTextureMb: 8 },
  capabilities: ["dom"],
  fields: [
    { id: "start-date", label: "Ngày", path: "startDate", required: true, type: "date" },
    {
      id: "name",
      label: "Tên",
      maxLength: 30,
      path: "person.name",
      required: true,
      type: "shortText",
    },
    { id: "photo", label: "Ảnh", path: "photo", type: "image" },
    {
      id: "lines",
      itemMaxLength: 40,
      label: "Lời nhắn",
      maxItems: 5,
      minItems: 0,
      path: "lines",
      type: "textList",
    },
    { id: "audio", label: "Nhạc", source: "licensedLibrary", type: "audio" },
  ],
  id: "test-html",
  kind: "html",
  meta: {
    description: "Mẫu thử.",
    estimatedDurationSec: 30,
    moods: ["romantic"],
    name: "Mẫu thử",
    occasions: ["anniversary"],
  },
  status: "published",
  version: "1.0.0",
} as const;

export const TEST_DEFAULTS = {
  lines: ["Một", "Hai"],
  person: { name: "Minh" },
  photo: "assets/photo.png",
  startDate: "2024-01-01",
  title: "LOVE",
};

export function testDocument(
  options: Readonly<{ body?: string; head?: string; defaults?: unknown }> = {},
): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Test</title>
<style>
  @font-face { font-family: "Hand"; src: url(assets/fonts/hand.woff2) format("woff2"); }
  .heart { clip-path: url(#clip); background: url("assets/photo.png"); }
</style>
${options.head ?? ""}
</head>
<body>
<svg viewBox="0 0 10 10"><defs><clipPath id="clip"><rect width="1" height="1"/></clipPath></defs><use href="#clip"/></svg>
<a href="#top">Lên đầu</a>
<img src="assets/photo.png" alt="">
${options.body ?? ""}
<script type="application/json" id="gift-config">${JSON.stringify(options.defaults ?? TEST_DEFAULTS)}</script>
<script>
const CONFIG = LoveGift.config();
document.title = CONFIG.title;
</script>
<script>
document.createElementNS("http://www.w3.org/2000/svg", "g");
</script>
</body>
</html>
`;
}

export function testSource(overrides: Partial<HtmlTemplateSource> = {}): HtmlTemplateSource {
  return {
    assets: [
      { bytes: WOFF2_BYTES, name: "assets/fonts/hand.woff2" },
      { bytes: PNG_BYTES, name: "assets/photo.png" },
    ],
    bootstrap: TEST_BOOTSTRAP,
    indexHtml: testDocument(),
    manifest: TEST_MANIFEST,
    ...overrides,
  };
}
