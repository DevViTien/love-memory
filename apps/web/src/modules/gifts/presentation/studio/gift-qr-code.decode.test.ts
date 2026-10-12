// @vitest-environment node
import jsQR from "jsqr";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildQrImage, createQrMatrix, QR_STYLES } from "./gift-qr-code";

// Round trip: each style's SVG is rasterized by a real SVG renderer (librsvg through sharp) at its
// PNG size and must decode back to the exact share URL.

async function decodeSvg(svg: string, width?: number): Promise<string | undefined> {
  const rendered = sharp(Buffer.from(svg));
  const { data, info } = await (width ? rendered.resize({ width }) : rendered)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  return jsQR(pixels, info.width, info.height)?.data;
}

describe("QR round trip", () => {
  const urls = [
    "https://lovememory.vn/g/Ab0_-cdefghijklmnopqrs",
    "http://127.0.0.1:3100/g/zZ9-_yxwvutsrqponmlkji",
    // A preview deployment: version 8.
    "https://love-memory-git-feature-x-team.vercel.app/g/Ab0_-cdefghijklmnopqrs",
  ];

  for (const url of urls) {
    it.each(QR_STYLES)(`decodes the %s style back to ${url}`, async (style) => {
      const image = buildQrImage(createQrMatrix(url), style);

      await expect(decodeSvg(image.svg)).resolves.toBe(url);
    });
  }

  it.each(urls)("decodes the heart downscaled to 300 px back to %s", async (url) => {
    const image = buildQrImage(createQrMatrix(url), "heart");

    await expect(decodeSvg(image.svg, 300)).resolves.toBe(url);
  });
});
