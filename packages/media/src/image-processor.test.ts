import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  ImageTooLargeError,
  InvalidImageError,
  processUploadedImage,
  UnsupportedImageFormatError,
} from "./image-processor";

describe("image processor", () => {
  it("decodes, auto-orients, bounds and re-encodes uploads without carrying metadata", async () => {
    const source = await sharp({
      create: {
        background: { alpha: 1, b: 90, g: 40, r: 220 },
        channels: 4,
        height: 1200,
        width: 1600,
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const output = await processUploadedImage(source, { outputWidth: 768 });
    const outputMetadata = await sharp(output.bytes).metadata();

    expect(output).toMatchObject({
      contentType: "image/webp",
      sourceContentType: "image/jpeg",
      width: 576,
    });
    expect(output.height).toBe(768);
    expect(outputMetadata.format).toBe("webp");
    expect(outputMetadata.exif).toBeUndefined();
    expect(outputMetadata.orientation).toBeUndefined();
  });

  it("rejects empty and oversized payloads before processing", async () => {
    await expect(processUploadedImage(new Uint8Array())).rejects.toBeInstanceOf(InvalidImageError);
    await expect(
      processUploadedImage(Uint8Array.from([1, 2]), { maximumInputBytes: 1 }),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("rejects decoded formats outside the image allowlist", async () => {
    const gif = await sharp({
      create: {
        background: "#fff",
        channels: 3,
        height: 10,
        width: 10,
      },
    })
      .gif()
      .toBuffer();

    await expect(processUploadedImage(gif)).rejects.toBeInstanceOf(UnsupportedImageFormatError);
  });

  it("normalizes decoder errors", async () => {
    await expect(processUploadedImage(Uint8Array.from([1, 2, 3]))).rejects.toBeInstanceOf(
      InvalidImageError,
    );
  });
});
