import { afterEach, describe, expect, it, vi } from "vitest";

import { svgDataUrl } from "./gift-qr-code";
import { blobToDataUrl, canSaveFiles, qrSvgBlob, renderQrPng, saveBlob } from "./gift-qr-download";

const image = { height: 20, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 10 };

function fakeCanvas(context: object | null, blob: Blob | null) {
  const canvas = {
    getContext: vi.fn(() => context),
    height: 0,
    toBlob: vi.fn((callback: BlobCallback, type?: string) => {
      expect(type).toBe("image/png");
      callback(blob);
    }),
    width: 0,
  };
  return canvas;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("renderQrPng", () => {
  it("draws the SVG at the image's full size and encodes a PNG", async () => {
    const source = { kind: "image" } as unknown as CanvasImageSource;
    const sizes: number[][] = [];
    const context = {
      drawImage: vi.fn(() => {
        sizes.push([canvas.width, canvas.height]);
      }),
    };
    const png = new Blob(["png"], { type: "image/png" });
    const canvas = fakeCanvas(context, png);
    const loadImage = vi.fn(() => Promise.resolve(source));

    const result = await renderQrPng(image, {
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
      loadImage,
    });

    expect(result).toBe(png);
    expect(loadImage).toHaveBeenCalledWith(svgDataUrl(image.svg));
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 10, 20);
    // The canvas had the image's size while drawing, and is released once encoded.
    expect(sizes).toEqual([[10, 20]]);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("fails without a 2D context", async () => {
    const canvas = fakeCanvas(null, null);

    await expect(
      renderQrPng(image, {
        createCanvas: () => canvas as unknown as HTMLCanvasElement,
        loadImage: () => Promise.resolve({} as CanvasImageSource),
      }),
    ).rejects.toThrow("Canvas 2D context unavailable.");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("fails when the canvas cannot encode", async () => {
    const canvas = fakeCanvas({ drawImage: vi.fn() }, null);

    await expect(
      renderQrPng(image, {
        createCanvas: () => canvas as unknown as HTMLCanvasElement,
        loadImage: () => Promise.resolve({} as CanvasImageSource),
      }),
    ).rejects.toThrow("PNG encoding failed.");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("fails when the browser cannot decode the SVG", async () => {
    // jsdom has no `HTMLImageElement.decode`; the browser's rejects for an undecodable image.
    const decode = vi.fn(function (this: HTMLImageElement) {
      expect(this.src).toBe(svgDataUrl(image.svg));
      return Promise.reject(new Error("decode"));
    });
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: decode,
    });
    try {
      await expect(renderQrPng(image)).rejects.toThrow("decode");
      expect(decode).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
    }
  });
});

describe("downloads", () => {
  it("wraps the SVG in an SVG blob", async () => {
    const blob = qrSvgBlob(image);

    expect(blob.type).toBe("image/svg+xml");
    await expect(blob.text()).resolves.toBe(image.svg);
  });

  it("saves through a temporary blob link and revokes it later", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:local/qr");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const blob = new Blob(["x"]);

    expect(saveBlob(blob, "qua-tang-qr.png")).toBe(true);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe("qua-tang-qr.png");
    expect(clicked[0]?.getAttribute("href")).toBe("blob:local/qr");
    // A browser that ignores `download` opens a new context instead of replacing the Studio.
    expect(clicked[0]?.target).toBe("_blank");
    expect(clicked[0]?.rel).toBe("noopener");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local/qr");
  });

  it("does nothing without download support, so the page is never replaced", () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "download");
    const createObjectURL = vi.fn(() => "blob:local/qr");
    Object.assign(URL, { createObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    expect(canSaveFiles()).toBe(true);
    Reflect.deleteProperty(HTMLAnchorElement.prototype, "download");
    try {
      expect(canSaveFiles()).toBe(false);
      expect(saveBlob(new Blob(["x"]), "qua-tang-qr.png")).toBe(false);
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(HTMLAnchorElement.prototype, "download", descriptor);
    }
  });

  it("reads a blob as a data URL", async () => {
    await expect(blobToDataUrl(new Blob(["png"], { type: "image/png" }))).resolves.toBe(
      "data:image/png;base64,cG5n",
    );
  });

  it("fails when the blob cannot be read", async () => {
    const error = new DOMException("unreadable", "NotReadableError");
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, "error", { value: error });
      this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
    });

    await expect(blobToDataUrl(new Blob(["x"]))).rejects.toBe(error);
  });
});
