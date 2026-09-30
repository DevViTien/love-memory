import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateCropRectangle,
  cropImageToAspectRatio,
  encodedContentType,
  parseAspectRatio,
} from "./image-crop";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image crop geometry", () => {
  it("parses template aspect ratios", () => {
    expect(parseAspectRatio("4:3")).toBeCloseTo(4 / 3);
    expect(() => parseAspectRatio("invalid")).toThrow(RangeError);
    expect(() => parseAspectRatio("4:0")).toThrow(RangeError);
  });

  it("crops landscape images around the selected horizontal focal point", () => {
    expect(calculateCropRectangle(2_000, 1_000, 1, 0.75, 0.5)).toEqual({
      height: 1_000,
      width: 1_000,
      x: 750,
      y: 0,
    });
  });

  it("crops portrait images around the selected vertical focal point", () => {
    expect(calculateCropRectangle(1_000, 2_000, 1, 0.5, 0.25)).toEqual({
      height: 1_000,
      width: 1_000,
      x: 0,
      y: 250,
    });
    expect(() => calculateCropRectangle(0, 2_000, 1, 0.5, 0.25)).toThrow(RangeError);
  });

  it("encodes a bounded WebP crop and releases the decoded bitmap", async () => {
    const close = vi.fn();
    const bitmap = { close, height: 3_000, width: 6_000 } as unknown as ImageBitmap;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const drawImage = vi.fn();
    const canvas = {
      getContext: vi.fn(() => ({ drawImage })),
      height: 0,
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["webp"]))),
      width: 0,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);

    const source = new File(["source"], "memory.jpg", {
      lastModified: 123,
      type: "image/jpeg",
    });
    const result = await cropImageToAspectRatio(source, "1:1", 0.75, 0.5);

    expect(drawImage).toHaveBeenCalledWith(bitmap, 2_250, 0, 3_000, 3_000, 0, 0, 2_048, 2_048);
    expect(result.name).toBe("memory-cropped.webp");
    expect(result.type).toBe("image/webp");
    expect(result.lastModified).toBe(123);
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("labels the crop with the format the browser actually encoded", () => {
    expect(encodedContentType("image/png")).toBe("image/png");
    expect(encodedContentType("image/jpeg")).toBe("image/jpeg");
    expect(encodedContentType("image/webp")).toBe("image/webp");
    expect(encodedContentType("")).toBe("image/webp");
  });

  it.each([
    ["image/jpeg", "memory-cropped.jpg"],
    ["image/png", "memory-cropped.png"],
  ])(
    "re-encodes a crop without WebP support as JPEG (browser returned %s)",
    async (fallbackType, expectedName) => {
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(() => Promise.resolve({ close: vi.fn(), height: 100, width: 100 })),
      );
      const toBlob = vi.fn((callback: BlobCallback, type?: string) =>
        callback(new Blob(["bytes"], { type: type === "image/jpeg" ? fallbackType : "image/png" })),
      );
      const canvas = {
        getContext: vi.fn(() => ({ drawImage: vi.fn() })),
        height: 0,
        toBlob,
        width: 0,
      } as unknown as HTMLCanvasElement;
      vi.spyOn(document, "createElement").mockReturnValue(canvas);

      const result = await cropImageToAspectRatio(
        new File(["source"], "memory.jpg", { type: "image/jpeg" }),
        "1:1",
        0.5,
        0.5,
      );

      expect(toBlob.mock.calls.map((call) => call[1])).toEqual(["image/webp", "image/jpeg"]);
      expect(result.name).toBe(expectedName);
      expect(result.type).toBe(fallbackType);
    },
  );
});
