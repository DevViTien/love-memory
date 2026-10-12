import { describe, expect, it } from "vitest";

import {
  buildQrImage,
  createQrMatrix,
  QR_DARK_COLOR,
  QR_LIGHT_COLOR,
  QR_QUIET_ZONE,
  QR_STYLES,
  QR_WALLPAPER_TEXT,
  qrFileName,
  qrModulesPath,
  type QrMatrix,
  svgDataUrl,
} from "./gift-qr-code";

const shareUrl = "https://lovememory.vn/g/Ab0_-cdefghijklmnopqrs";
/** A long preview-deployment URL (74 bytes): version 8, 49 × 49 modules. */
const previewUrl = "https://love-memory-git-feature-x-team.vercel.app/g/Ab0_-cdefghijklmnopqrs";

function parseSvg(svg: string): SVGSVGElement {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  const root = document.documentElement as unknown as SVGSVGElement;
  expect(root.tagName).toBe("svg");
  return root;
}

/** The dark cells a `qrModulesPath` path paints, given its module size. */
function paintedCells(path: string, unit: number): number {
  return [...path.matchAll(/h(\d+)v/g)].reduce((sum, match) => sum + Number(match[1]) / unit, 0);
}

function darkCells(matrix: QrMatrix): number {
  return matrix.cells.filter(Boolean).length;
}

describe("createQrMatrix", () => {
  it("builds a square level H matrix that only depends on the text", () => {
    const matrix = createQrMatrix(shareUrl);

    // 46 bytes at level H need version 6: 41 × 41 modules.
    expect(matrix.size).toBe(41);
    expect(matrix.cells).toHaveLength(41 * 41);
    expect(createQrMatrix(shareUrl)).toEqual(matrix);
    expect(createQrMatrix(`${shareUrl}x`).cells).not.toEqual(matrix.cells);
  });
});

describe("qrModulesPath", () => {
  it("draws one rectangle per horizontal run of dark modules", () => {
    const matrix: QrMatrix = {
      cells: [true, true, false, false, false, true, true, false, true],
      size: 3,
    };

    expect(qrModulesPath(matrix, 10, 20, 4)).toBe(
      "M10 20h8v4h-8z" + "M18 24h4v4h-4z" + "M10 28h4v4h-4z" + "M18 28h4v4h-4z",
    );
  });

  it("is empty for a matrix without dark modules", () => {
    expect(qrModulesPath({ cells: [false], size: 1 }, 0, 0, 1)).toBe("");
  });
});

describe("buildQrImage", () => {
  const matrix = createQrMatrix(shareUrl);
  const sizes = {
    heart: [1024, 1024],
    plain: [1024, 1024],
    wallpaper: [1080, 2340],
  } as const;

  it.each(QR_STYLES)("builds a well-formed, self-contained %s SVG", (style) => {
    const image = buildQrImage(matrix, style);
    const [width, height] = sizes[style];
    const root = parseSvg(image.svg);

    expect([image.width, image.height]).toEqual([width, height]);
    expect(root.getAttribute("width")).toBe(String(width));
    expect(root.getAttribute("height")).toBe(String(height));
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${width} ${height}`);
    // No external reference, script, link or embedded share URL: only the namespace is a URL.
    expect(image.svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(
      /https?:|href|<script|<image|<foreignObject|@import/i,
    );
    for (const reference of image.svg.matchAll(/url\(([^)]*)\)/g)) {
      expect(reference[1]).toMatch(/^#[a-z-]+$/);
    }
    expect(image.svg).not.toContain("lovememory");
  });

  it.each(QR_STYLES)("paints exactly the dark modules of the matrix in %s", (style) => {
    const root = parseSvg(buildQrImage(matrix, style).svg);
    const modules = [...root.querySelectorAll("path")].filter(
      (path) => path.getAttribute("fill") === QR_DARK_COLOR,
    );

    expect(modules).toHaveLength(1);
    const path = modules[0]?.getAttribute("d") ?? "";
    const unit = Number(/v(\d+)h/.exec(path)?.[1]);
    expect(unit).toBeGreaterThanOrEqual(8);
    expect(paintedCells(path, unit)).toBe(darkCells(matrix));
  });

  it("needs version 8 for a long preview URL", () => {
    expect(createQrMatrix(previewUrl).size).toBe(49);
  });

  it("gives a version 6 code at least 10 px modules in the heart", () => {
    const path =
      parseSvg(buildQrImage(matrix, "heart").svg)
        .querySelector(`path[fill="${QR_DARK_COLOR}"]`)
        ?.getAttribute("d") ?? "";

    expect(Number(/v(\d+)h/.exec(path)?.[1])).toBeGreaterThanOrEqual(10);
  });

  describe.each([
    ["production", shareUrl],
    ["preview", previewUrl],
  ])("quiet zone for the %s URL", (_name, url) => {
    const urlMatrix = createQrMatrix(url);

    it.each(QR_STYLES)("keeps at least 4 light modules around the %s code", (style) => {
      const root = parseSvg(buildQrImage(urlMatrix, style).svg);
      const cards = root.querySelectorAll(`rect[fill="${QR_LIGHT_COLOR}"]`);
      expect(cards).toHaveLength(1);
      const card = cards[0] as SVGRectElement;
      const [x, y, width, height, radius] = ["x", "y", "width", "height", "rx"].map((name) =>
        Number(card.getAttribute(name) ?? 0),
      ) as [number, number, number, number, number];
      const path = root.querySelector(`path[fill="${QR_DARK_COLOR}"]`)?.getAttribute("d") ?? "";
      // The top-left finder pattern makes module (0, 0) dark, so the path starts at the symbol.
      const [, left, top, unit] = /^M(\d+) (\d+)h\d+v(\d+)h/.exec(path)?.map(Number) ?? [];
      if (left === undefined || top === undefined || unit === undefined) {
        throw new Error("Unexpected module path.");
      }
      const side = unit * urlMatrix.size;
      const quiet = QR_QUIET_ZONE * unit;
      const margins = [left - x, top - y, x + width - (left + side), y + height - (top + side)];

      expect(Math.min(...margins)).toBeGreaterThanOrEqual(quiet);
      // The rounded corners stay outside the quiet zone's corners.
      expect(Math.min(...margins) - quiet).toBeGreaterThanOrEqual(radius * (1 - Math.SQRT1_2));
      expect(paintedCells(path, unit)).toBe(darkCells(urlMatrix));
      expect(unit).toBeGreaterThanOrEqual(8);
    });
  });

  it("writes the scan prompt on the wallpaper", () => {
    const texts = [...parseSvg(buildQrImage(matrix, "wallpaper").svg).querySelectorAll("text")];

    expect(texts.map((text) => text.textContent)).toContain(QR_WALLPAPER_TEXT);
  });
});

describe("file names and data URLs", () => {
  it("names downloads by style and format only", () => {
    expect(qrFileName("plain", "png")).toBe("qua-tang-qr.png");
    expect(qrFileName("plain", "svg")).toBe("qua-tang-qr.svg");
    expect(qrFileName("heart", "png")).toBe("qua-tang-qr-trai-tim.png");
    expect(qrFileName("wallpaper", "svg")).toBe("qua-tang-qr-hinh-nen.svg");
  });

  it("encodes the SVG into a data URL", () => {
    const url = svgDataUrl('<svg a="#"/>');

    expect(url).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23%22%2F%3E");
    expect(decodeURIComponent(url.split(",")[1] ?? "")).toBe('<svg a="#"/>');
  });
});
