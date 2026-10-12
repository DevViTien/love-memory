import { type QrImage, svgDataUrl } from "./gift-qr-code";

/**
 * Browser side of `gift-qr-codes`: the PNG is drawn from the style's SVG on a canvas, and every
 * download is a local `blob:` URL. Nothing leaves the browser.
 */

export type RasterDependencies = Readonly<{
  createCanvas: () => HTMLCanvasElement;
  loadImage: (source: string) => Promise<CanvasImageSource>;
}>;

async function loadImageElement(source: string): Promise<CanvasImageSource> {
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  await image.decode();
  return image;
}

const browserRaster: RasterDependencies = {
  createCanvas: () => document.createElement("canvas"),
  loadImage: loadImageElement,
};

/** The PNG of `image` at its full pixel size. */
export async function renderQrPng(
  image: QrImage,
  dependencies: RasterDependencies = browserRaster,
): Promise<Blob> {
  const source = await dependencies.loadImage(svgDataUrl(image.svg));
  const canvas = dependencies.createCanvas();
  canvas.width = image.width;
  canvas.height = image.height;
  // iOS caps the total canvas memory of a page: every canvas is shrunk to nothing once used.
  const release = () => {
    canvas.width = 0;
    canvas.height = 0;
  };
  const context = canvas.getContext("2d");
  if (!context) {
    release();
    throw new Error("Canvas 2D context unavailable.");
  }
  context.drawImage(source, 0, 0, image.width, image.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      release();
      if (blob) resolve(blob);
      else reject(new Error("PNG encoding failed."));
    }, "image/png");
  });
}

export function qrSvgBlob(image: QrImage): Blob {
  return new Blob([image.svg], { type: "image/svg+xml" });
}

/**
 * `blob` as a `data:` URL. The preview uses it instead of a `blob:` URL: some in-app browsers
 * cannot save a `blob:` image on a long press.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // `readAsDataURL` always yields a string.
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Blob read failed."));
    };
    reader.readAsDataURL(blob);
  });
}

/** Whether this browser knows the `download` attribute of links. */
export function canSaveFiles(): boolean {
  return "download" in HTMLAnchorElement.prototype;
}

/**
 * Saves `blob` as `fileName` through a temporary link to a `blob:` URL, and answers whether it
 * tried. Without `download` support it does nothing, so the Studio page is never replaced by the
 * file; the link also targets a new browsing context for browsers that ignore the attribute.
 */
export function saveBlob(blob: Blob, fileName: string): boolean {
  if (!canSaveFiles()) return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.target = "_blank";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking right after the click can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
