import { create } from "qrcode";

/**
 * QR codes of a published gift's share URL (`gift-qr-codes`). Everything here is pure: the matrix
 * comes from `qrcode` at error correction level H, and each style is a self-contained SVG string
 * (no external reference, no script, no user text) built from that matrix. The browser renders the
 * PNG from the same SVG (`gift-qr-download.ts`).
 */

export const QR_STYLES = ["plain", "heart", "wallpaper"] as const;
export type QrStyle = (typeof QR_STYLES)[number];

export const QR_STYLE_LABELS: Readonly<Record<QrStyle, string>> = {
  heart: "Khung trái tim",
  plain: "Cơ bản",
  wallpaper: "Hình nền điện thoại",
};

/** The file name of a download: never the share id, the gift's text or anything gift-specific. */
const QR_FILE_BASENAMES: Readonly<Record<QrStyle, string>> = {
  heart: "qua-tang-qr-trai-tim",
  plain: "qua-tang-qr",
  wallpaper: "qua-tang-qr-hinh-nen",
};

export const QR_WALLPAPER_TEXT = "Quét để mở món quà";
export const QR_WALLPAPER_SUBTEXT = "Một món quà dành riêng cho bạn";

/** The light quiet zone around the symbol, in modules (ISO/IEC 18004 asks for at least 4). */
export const QR_QUIET_ZONE = 4;
export const QR_DARK_COLOR = "#1c1917";
export const QR_LIGHT_COLOR = "#ffffff";

const SQUARE_SIZE = 1024;
const WALLPAPER_WIDTH = 1080;
const WALLPAPER_HEIGHT = 2340;

export type QrFormat = "png" | "svg";

export type QrMatrix = Readonly<{
  /** Row-major, `size * size` cells; `true` is a dark module. */
  cells: readonly boolean[];
  size: number;
}>;

export type QrImage = Readonly<{
  height: number;
  svg: string;
  width: number;
}>;

/** The QR matrix of `text` at error correction level H, so a decorated code still scans. */
export function createQrMatrix(text: string): QrMatrix {
  const { modules } = create(text, { errorCorrectionLevel: "H" });
  return { cells: Array.from(modules.data, (cell) => cell === 1), size: modules.size };
}

export function qrFileName(style: QrStyle, format: QrFormat): string {
  return `${QR_FILE_BASENAMES[style]}.${format}`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * The dark modules as one path: one rectangle per horizontal run of dark modules, in whole pixels
 * from (`left`, `top`) with `unit` pixels per module, so the edges stay crisp.
 */
export function qrModulesPath(matrix: QrMatrix, left: number, top: number, unit: number): string {
  const commands: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let column = 0;
    while (column < matrix.size) {
      if (!matrix.cells[row * matrix.size + column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < matrix.size && matrix.cells[row * matrix.size + column]) column += 1;
      const width = (column - start) * unit;
      commands.push(`M${left + start * unit} ${top + row * unit}h${width}v${unit}h-${width}z`);
    }
  }
  return commands.join("");
}

/**
 * The light card of `side` pixels at (`left`, `top`) with the symbol centred on it. The module
 * size is a whole number of pixels and leaves at least the quiet zone on every side; the rest is
 * extra margin. A rounded corner of radius r cuts r(1 − 1/√2) into the card along its diagonal, so
 * the radius shrinks until the corners of the quiet zone stay light.
 */
function qrCard(
  matrix: QrMatrix,
  card: Readonly<{ left: number; radius: number; side: number; top: number }>,
): string {
  const unit = Math.floor(card.side / (matrix.size + 2 * QR_QUIET_ZONE));
  const symbolSide = unit * matrix.size;
  const margin = Math.floor((card.side - symbolSide) / 2);
  const slack = margin - QR_QUIET_ZONE * unit;
  const radius = Math.min(card.radius, Math.floor(slack / (1 - Math.SQRT1_2)));
  return (
    `<rect x="${card.left}" y="${card.top}" width="${card.side}" height="${card.side}" ` +
    `rx="${radius}" fill="${QR_LIGHT_COLOR}" shape-rendering="geometricPrecision"/>` +
    `<path fill="${QR_DARK_COLOR}" ` +
    `d="${qrModulesPath(matrix, card.left + margin, card.top + margin, unit)}"/>`
  );
}

function svgDocument(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${body}</svg>`
  );
}

/** A heart in a 100 × 100 box; its notch is at (50, 19). */
const HEART_PATH =
  "M50 90C50 90 4 62 4 32C4 15 16 5 29 5C39 5 46 11 50 19C54 11 61 5 71 5C84 5 96 15 96 32" +
  "C96 62 50 90 50 90Z";
/**
 * The white square inside the heart. The largest centred square that fits is about 50.8 units
 * wide; 48.5 units fits with the top anywhere from 19 to 22.5, so 21 leaves a margin at the notch
 * and at the lower curves. At 1024 px it is 497 px: 10 px modules for a version 6 code.
 */
const HEART_CARD = { left: 25.75, side: 48.5, top: 21 } as const;

function plainImage(matrix: QrMatrix): QrImage {
  const body = qrCard(matrix, { left: 0, radius: 0, side: SQUARE_SIZE, top: 0 });
  return {
    height: SQUARE_SIZE,
    svg: svgDocument(SQUARE_SIZE, SQUARE_SIZE, body),
    width: SQUARE_SIZE,
  };
}

function heartImage(matrix: QrMatrix): QrImage {
  const scale = SQUARE_SIZE / 100;
  const cardLeft = Math.round(HEART_CARD.left * scale);
  const cardTop = Math.round(HEART_CARD.top * scale);
  const cardSide = Math.round(HEART_CARD.side * scale);
  const body =
    `<defs><linearGradient id="heart-fill" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fb7185"/><stop offset="1" stop-color="#e11d48"/>` +
    `</linearGradient></defs>` +
    `<rect width="${SQUARE_SIZE}" height="${SQUARE_SIZE}" fill="#fff1f2"/>` +
    `<g transform="scale(${scale})" shape-rendering="geometricPrecision">` +
    `<path d="${HEART_PATH}" fill="url(#heart-fill)"/>` +
    `<path d="${HEART_PATH}" fill="none" stroke="#ffe4e6" stroke-width="1.2" ` +
    `transform="translate(50 47) scale(0.92) translate(-50 -47)"/>` +
    `</g>` +
    qrCard(matrix, { left: cardLeft, radius: 24, side: cardSide, top: cardTop });
  return {
    height: SQUARE_SIZE,
    svg: svgDocument(SQUARE_SIZE, SQUARE_SIZE, body),
    width: SQUARE_SIZE,
  };
}

function wallpaperImage(matrix: QrMatrix): QrImage {
  const cardSide = 720;
  const cardLeft = (WALLPAPER_WIDTH - cardSide) / 2;
  const cardTop = 900;
  const centre = WALLPAPER_WIDTH / 2;
  const text = `font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" text-anchor="middle"`;
  const body =
    `<defs><linearGradient id="wallpaper-fill" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="#fff1f2"/><stop offset="0.55" stop-color="#fecdd3"/>` +
    `<stop offset="1" stop-color="#fda4af"/></linearGradient></defs>` +
    `<rect width="${WALLPAPER_WIDTH}" height="${WALLPAPER_HEIGHT}" fill="url(#wallpaper-fill)"/>` +
    `<g shape-rendering="geometricPrecision">` +
    `<path d="${HEART_PATH}" fill="#e11d48" transform="translate(${centre - 40} 640) scale(0.8)"/>` +
    `<text x="${centre}" y="820" ${text} font-size="72" font-weight="700" fill="#881337">` +
    `${QR_WALLPAPER_TEXT}</text>` +
    `<text x="${centre}" y="${cardTop + cardSide + 110}" ${text} font-size="44" ` +
    `fill="#9f1239">${QR_WALLPAPER_SUBTEXT}</text>` +
    `</g>` +
    qrCard(matrix, { left: cardLeft, radius: 48, side: cardSide, top: cardTop });
  return {
    height: WALLPAPER_HEIGHT,
    svg: svgDocument(WALLPAPER_WIDTH, WALLPAPER_HEIGHT, body),
    width: WALLPAPER_WIDTH,
  };
}

/** The SVG of `style` and the pixel size of its PNG. */
export function buildQrImage(matrix: QrMatrix, style: QrStyle): QrImage {
  switch (style) {
    case "heart":
      return heartImage(matrix);
    case "wallpaper":
      return wallpaperImage(matrix);
    case "plain":
      return plainImage(matrix);
  }
}
