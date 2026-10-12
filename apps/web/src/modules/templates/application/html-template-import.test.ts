import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  classifyTemplateUrl,
  DEFERRED_SCRIPT_TYPE,
  parseHtmlTemplate,
} from "./html-template-document";
import {
  BOOTSTRAP_FIELDS_MARKER,
  computeArtifactContentHash,
  HtmlTemplateImportError,
  prepareHtmlTemplate,
  renderBootstrap,
  sha256Hex,
} from "./html-template-import";
import {
  PNG_BYTES,
  TEST_BOOTSTRAP,
  TEST_DEFAULTS,
  TEST_MANIFEST,
  testDocument,
  testSource,
} from "./test/html-template-fixtures";

const decoder = new TextDecoder();

function problemsOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof HtmlTemplateImportError) return error.problems;
    throw error;
  }
  throw new Error("The import was accepted.");
}

describe("prepareHtmlTemplate (happy path)", () => {
  const prepared = prepareHtmlTemplate(testSource());
  const file = (name: string) => prepared.files.find((candidate) => candidate.name === name);

  it("builds the artifact files with content types and hashes", () => {
    expect(prepared.files.map((candidate) => [candidate.name, candidate.contentType])).toEqual([
      ["index.html", "text/html; charset=utf-8"],
      ["love-gift.js", "text/javascript; charset=utf-8"],
      ["script-1.js", "text/javascript; charset=utf-8"],
      ["script-2.js", "text/javascript; charset=utf-8"],
      ["assets/fonts/hand.woff2", "font/woff2"],
      ["assets/photo.png", "image/png"],
    ]);
    for (const candidate of prepared.files) {
      expect(candidate.sha256).toBe(sha256Hex(candidate.body));
      expect(candidate.sizeBytes).toBe(candidate.body.byteLength);
    }
    expect(prepared.artifactContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.artifactContentHash).toBe(computeArtifactContentHash(prepared.files));
  });

  it("loads the bootstrap first and defers every inline script in place", () => {
    const document = decoder.decode(file("index.html")?.body);

    expect(document).toMatch(/<head>\n<script src="love-gift.js"><\/script>\n<meta charset/);
    expect(document).toContain(`<script type="${DEFERRED_SCRIPT_TYPE}" data-src="script-1.js">`);
    expect(document).toContain(`<script type="${DEFERRED_SCRIPT_TYPE}" data-src="script-2.js">`);
    expect(document).not.toContain("LoveGift.config()");
    expect(document).toContain('<script type="application/json" id="gift-config">');
    expect(decoder.decode(file("script-1.js")?.body)).toContain(
      "const CONFIG = LoveGift.config();",
    );
  });

  it("embeds the version's field mapping in the bootstrap, without the audio field", () => {
    expect(decoder.decode(file("love-gift.js")?.body)).toBe(
      'window.FIELDS = [{"id":"start-date","path":"startDate","type":"date"},' +
        '{"id":"name","path":"person.name","type":"shortText"},' +
        '{"id":"photo","path":"photo","type":"image"},' +
        '{"id":"lines","path":"lines","type":"textList"}];\n',
    );
  });

  it("keeps the defaults and completes the stored manifest", () => {
    expect(prepared.defaults).toEqual(TEST_DEFAULTS);
    expect(prepared.storedManifest).toEqual({
      ...TEST_MANIFEST,
      engineVersion: "1.0.0",
      entry: "index.html",
      previewFixture: "index.html",
    });
    expect(prepared.manifest.kind).toBe("html");
  });

  it("measures the JavaScript gzip size and the media size", () => {
    const javascript = ["love-gift.js", "script-1.js", "script-2.js"].map(
      (name) => file(name)?.body ?? new Uint8Array(),
    );
    expect(javascript.every((body) => body.byteLength > 0)).toBe(true);
    expect(prepared.metrics.initialJsKbGzip).toBeGreaterThan(0);
    expect(prepared.metrics.initialMediaKb).toBeCloseTo(19 / 1024, 2);
    expect(prepared.metrics.maxTextureMb).toBe(0);
    expect(gunzipSync).toBeTypeOf("function");
  });

  it("is deterministic: the same folder gives the same artifact hash", () => {
    expect(prepareHtmlTemplate(testSource()).artifactContentHash).toBe(
      prepared.artifactContentHash,
    );
    expect(
      prepareHtmlTemplate(testSource({ indexHtml: testDocument({ body: "<p>x</p>" }) }))
        .artifactContentHash,
    ).not.toBe(prepared.artifactContentHash);
  });
});

describe("prepareHtmlTemplate refusals", () => {
  it.each([
    ["an inline event handler", { body: '<button onclick="go()">x</button>' }, "inline event"],
    ["a javascript: URL", { body: '<img src="javascript:alert(1)">' }, "only the template's own"],
    ["an external image", { body: '<img src="https://cdn.example/x.png">' }, "only the"],
    ["a protocol-relative URL", { body: '<img src="//cdn.example/x.png">' }, "only the"],
    ["an external srcset", { body: '<img srcset="a.png 1x, https://x/b.png 2x">' }, "srcset"],
    ["a missing file", { body: '<img src="assets/missing.png">' }, "not a file"],
    ["a parent path", { body: '<img src="../secret.png">' }, "only the"],
    ["a navigating link", { body: '<a href="https://example.com">x</a>' }, "#fragment"],
    ["a relative link", { body: '<a href="../../">x</a>' }, "#fragment"],
    ["an iframe", { body: '<iframe src="#"></iframe>' }, "<iframe>"],
    ["an object", { body: "<object></object>" }, "<object>"],
    ["an embed", { body: "<embed>" }, "<embed>"],
    ["a form", { body: "<form></form>" }, "<form>"],
    ["a base", { head: '<base href="/">' }, "<base>"],
    ["a stylesheet link", { head: '<link rel="stylesheet" href="x.css">' }, "<link>"],
    ["a meta refresh", { head: '<meta http-equiv="refresh" content="0">' }, "http-equiv"],
    ["an @import", { head: "<style>@import url(assets/photo.png);</style>" }, "@import"],
    ["an external CSS url", { head: "<style>b{background:url(https://x/y.png)}</style>" }, "url()"],
    ["an external style attribute", { body: '<p style="background:url(//x/y)">x</p>' }, "style"],
    ["a script src", { body: '<script src="assets/x.js"></script>' }, "<script src>"],
    ["a module script", { body: '<script type="module">1</script>' }, "Module"],
    [
      "a reserved script type",
      { body: `<script type="${DEFERRED_SCRIPT_TYPE}"></script>` },
      "reserved",
    ],
    ["an SVG script", { body: "<svg><script>alert(1)</script></svg>" }, "SVG"],
    [
      "an external URL in a script",
      { body: "<script>fetch('https://x.example')</script>" },
      "external",
    ],
    ["a form action", { body: '<button formaction="/x">x</button>' }, "not allowed"],
    ["an srcdoc", { body: '<div srcdoc="x"></div>' }, "not allowed"],
  ])("refuses %s", (_, document, expected) => {
    const problems = problemsOf(() =>
      prepareHtmlTemplate(testSource({ indexHtml: testDocument(document) })),
    );
    expect(problems.join("\n")).toContain(expected);
  });

  it("refuses a document without exactly one gift-config block", () => {
    const missing = testDocument().replace(' id="gift-config"', "");
    const twice = testDocument({
      body: '<script type="application/json" id="gift-config">{}</script>',
    });
    const wrongType = testDocument().replace(
      'type="application/json" id="gift-config"',
      'type="text/plain" id="gift-config"',
    );
    expect(problemsOf(() => prepareHtmlTemplate(testSource({ indexHtml: missing })))).toContain(
      'Expected exactly one <script type="application/json" id="gift-config">.',
    );
    expect(problemsOf(() => prepareHtmlTemplate(testSource({ indexHtml: twice })))).toContain(
      'Expected exactly one <script type="application/json" id="gift-config">.',
    );
    expect(
      problemsOf(() => prepareHtmlTemplate(testSource({ indexHtml: wrongType }))).join("\n"),
    ).toContain('must be type="application/json"');
  });

  it("refuses invalid JSON defaults and defaults that are not an object", () => {
    const invalid = testDocument().replace(JSON.stringify(TEST_DEFAULTS), "{ nope");
    expect(problemsOf(() => prepareHtmlTemplate(testSource({ indexHtml: invalid })))).toContain(
      "#gift-config is not valid JSON.",
    );
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(testSource({ indexHtml: testDocument({ defaults: [] }) })),
      ),
    ).toContain("The gift-config block must hold a JSON object.");
  });

  it("refuses a document without an explicit head", () => {
    const html = testDocument().replace("<head>", "").replace("</head>", "");
    expect(problemsOf(() => prepareHtmlTemplate(testSource({ indexHtml: html })))).toContain(
      "The document needs an explicit <head> element.",
    );
  });

  it.each([
    [{ ...TEST_DEFAULTS, startDate: undefined }, "does not exist"],
    [{ ...TEST_DEFAULTS, person: "Minh" }, "does not exist"],
    [{ ...TEST_DEFAULTS, startDate: 20240101 }, "must be a string"],
    [{ ...TEST_DEFAULTS, lines: "Một" }, "must be a list of strings"],
    [{ ...TEST_DEFAULTS, lines: [1] }, "must be a list of strings"],
    [{ ...TEST_DEFAULTS, photo: "https://x/y.png" }, "an image default"],
    [{ ...TEST_DEFAULTS, photo: "assets/missing.png" }, "not a file"],
  ])("refuses defaults that do not match the field paths (%#)", (defaults, expected) => {
    const problems = problemsOf(() =>
      prepareHtmlTemplate(testSource({ indexHtml: testDocument({ defaults }) })),
    );
    expect(problems.join("\n")).toContain(expected);
  });

  it("checks the defaults of image lists and captioned image lists", () => {
    const manifest = {
      ...TEST_MANIFEST,
      fields: [
        {
          aspectRatio: "1:1",
          id: "photos",
          label: "Ảnh",
          maxItems: 3,
          minItems: 0,
          path: "photos",
          type: "imageList",
        },
        {
          aspectRatio: "1:1",
          captionMaxLength: 40,
          id: "memories",
          label: "Kỷ niệm",
          maxItems: 3,
          minItems: 0,
          path: "memories",
          type: "captionedImageList",
        },
      ],
    };
    const accepted = { memories: [{ caption: "x", src: "assets/photo.png" }], photos: [""] };
    expect(() =>
      prepareHtmlTemplate(
        testSource({ indexHtml: testDocument({ defaults: accepted }), manifest }),
      ),
    ).not.toThrow();
    const refused = { memories: [{ src: "https://x/y.png" }], photos: ["#x"] };
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(
          testSource({ indexHtml: testDocument({ defaults: refused }), manifest }),
        ),
      ),
    ).toHaveLength(2);
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(
          testSource({
            indexHtml: testDocument({ defaults: { memories: ["x"], photos: [] } }),
            manifest,
          }),
        ),
      ).join("\n"),
    ).toContain("must be a list of objects");
  });

  it.each([
    [{ ...TEST_MANIFEST, kind: "sdk" }, '"kind": "html"'],
    [{ ...TEST_MANIFEST, kind: undefined }, '"kind": "html"'],
    [{ ...TEST_MANIFEST, entry: "main.html" }, "entry"],
    [{ ...TEST_MANIFEST, version: "1.0.0+build.1" }, "build metadata"],
    [
      {
        ...TEST_MANIFEST,
        fields: [{ id: "name", label: "Tên", maxLength: 30, type: "shortText" }],
      },
      "needs a path",
    ],
    ["not an object", "JSON object"],
  ])("refuses an invalid template.json (%#)", (manifest, expected) => {
    expect(problemsOf(() => prepareHtmlTemplate(testSource({ manifest }))).join("\n")).toContain(
      expected,
    );
  });

  it.each([
    [{ bytes: PNG_BYTES, name: "photo.png" }, "under assets/"],
    [{ bytes: PNG_BYTES, name: "assets/my photo.png" }, "under assets/"],
    [{ bytes: PNG_BYTES, name: "assets/../photo.png" }, "under assets/"],
    [{ bytes: PNG_BYTES, name: "assets/x.gif" }, "only woff2"],
    [{ bytes: PNG_BYTES, name: "assets/x.js" }, "only woff2"],
    [{ bytes: new Uint8Array([1, 2, 3]), name: "assets/x.png" }, "does not match"],
    [{ bytes: new Uint8Array([1, 2, 3]), name: "assets/x.jpg" }, "does not match"],
    [{ bytes: new Uint8Array([1, 2, 3]), name: "assets/x.webp" }, "does not match"],
    [{ bytes: new Uint8Array([1, 2, 3]), name: "assets/x.woff2" }, "does not match"],
    [
      { bytes: new TextEncoder().encode("<svg><script>1</script></svg>"), name: "assets/x.svg" },
      "assets/x.svg: <script> is not allowed.",
    ],
    [
      { bytes: new TextEncoder().encode('<svg onload="x()"></svg>'), name: "assets/y.svg" },
      "Event handler",
    ],
    [
      {
        bytes: new TextEncoder().encode('<svg><image href="https://x/y"/></svg>'),
        name: "assets/z.svg",
      },
      "Links may only",
    ],
    [{ bytes: new Uint8Array(2 * 1024 * 1024 + 1).fill(0xff), name: "assets/big.jpg" }, "2 MB"],
    [{ bytes: PNG_BYTES, name: "assets/a/b/c/d/e/f.png" }, "at most 6 segments"],
    [
      { bytes: new TextEncoder().encode("<html><body/></html>"), name: "assets/n.svg" },
      "not an SVG",
    ],
  ])("refuses the asset %#", (asset, expected) => {
    const problems = problemsOf(() =>
      prepareHtmlTemplate(testSource({ assets: [...testSource().assets, asset] })),
    );
    expect(problems.join("\n")).toContain(expected);
  });

  it("accepts safe SVG, JPEG and WebP assets", () => {
    const assets = [
      ...testSource().assets,
      {
        bytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0"/></svg>',
        ),
        name: "assets/heart.svg",
      },
      { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), name: "assets/a.jpeg" },
      {
        bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        name: "assets/b.webp",
      },
    ];
    const prepared = prepareHtmlTemplate(testSource({ assets }));
    expect(prepared.files.map((file) => file.contentType)).toContain("image/svg+xml");
    expect(prepared.files.map((file) => file.contentType)).toContain("image/webp");
  });

  it("refuses an oversized document, too many assets and a folder over 8 MB", () => {
    const bigDocument = testDocument({ body: `<p>${"x".repeat(512 * 1024)}</p>` });
    expect(problemsOf(() => prepareHtmlTemplate(testSource({ indexHtml: bigDocument })))).toContain(
      "index.html must be at most 512 KB.",
    );
    const many = Array.from({ length: 61 }, (_, index) => ({
      bytes: PNG_BYTES,
      name: `assets/p${index}.png`,
    }));
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(testSource({ assets: [...testSource().assets, ...many] })),
      ),
    ).toContain("At most 60 asset files are allowed.");
    const heavy = Array.from({ length: 5 }, (_, index) => ({
      bytes: new Uint8Array(2 * 1024 * 1024)
        .fill(0xff)
        .map((byte, at) => (at < 3 ? ([0xff, 0xd8, 0xff][at] ?? byte) : byte)),
      name: `assets/h${index}.jpg`,
    }));
    expect(
      problemsOf(() =>
        prepareHtmlTemplate(testSource({ assets: [...testSource().assets, ...heavy] })),
      ),
    ).toContain("The template must be at most 8 MB in all.");
  });

  it("refuses a template over its declared budgets", () => {
    const manifest = {
      ...TEST_MANIFEST,
      budgets: { initialJsKbGzip: 1, initialMediaKb: 0, maxTextureMb: 1 },
    };
    const bigScript = `<script>${Array.from({ length: 3000 }, (_, index) => `var v${index} = ${index * 7919};`).join("\n")}</script>`;
    const problems = problemsOf(() =>
      prepareHtmlTemplate(testSource({ indexHtml: testDocument({ body: bigScript }), manifest })),
    );
    expect(problems.join("\n")).toMatch(/Budget initialJsKbGzip: [\d.]+ > 1/);
    expect(problems.join("\n")).toMatch(/Budget initialMediaKb: [\d.]+ > 0/);
  });

  it("refuses a bootstrap without the field marker", () => {
    expect(() => renderBootstrap("no marker", prepareHtmlTemplate(testSource()).manifest)).toThrow(
      "The bootstrap source has no field marker.",
    );
    expect(TEST_BOOTSTRAP).toContain(BOOTSTRAP_FIELDS_MARKER);
  });

  it("lists every problem in its message", () => {
    const error = (() => {
      try {
        prepareHtmlTemplate(
          testSource({ indexHtml: testDocument({ body: '<a href="/">x</a><form></form>' }) }),
        );
      } catch (caught) {
        return caught as Error;
      }
      return null;
    })();
    expect(error?.message).toMatch(/^The template cannot be imported:\n- /);
    expect(error?.message.split("\n- ")).toHaveLength(3);
  });
});

describe("classifyTemplateUrl", () => {
  it.each([
    ["", { kind: "empty" }],
    ["#clip", { kind: "fragment" }],
    ["data:image/png;base64,AA", { kind: "data" }],
    ["DATA:image/png;base64,AA", { kind: "data" }],
    ["assets/a.png", { kind: "file", name: "assets/a.png" }],
    ["./assets/a.png?v=1#x", { kind: "file", name: "assets/a.png" }],
    ["java\nscript:alert(1)", { kind: "forbidden" }],
    [" https://x", { kind: "forbidden" }],
    ["//x", { kind: "forbidden" }],
    ["\\\\x", { kind: "forbidden" }],
    ["mailto:a@b", { kind: "forbidden" }],
    ["../a.png", { kind: "forbidden" }],
    ["./", { kind: "forbidden" }],
  ])("classifies %j", (url, expected) => {
    expect(classifyTemplateUrl(url)).toEqual(expected);
  });
});

describe("parseHtmlTemplate", () => {
  it("parses scripts inside a template element and keeps inert data blocks", () => {
    const parsed = parseHtmlTemplate(
      testDocument({
        body: '<template><script>var inTemplate = 1;</script></template><script type="text/x-template"><b>x</b></script>',
      }),
      new Set(["assets/photo.png", "assets/fonts/hand.woff2"]),
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.scripts.map((script) => script.source.trim())).toContain("var inTemplate = 1;");
    expect(parsed.document).toContain('<script type="text/x-template"><b>x</b></script>');
  });
});
