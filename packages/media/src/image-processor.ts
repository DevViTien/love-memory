import "server-only";

import sharp from "sharp";

export const IMAGE_PROCESSING_LIMITS = {
  maximumInputBytes: 10 * 1024 * 1024,
  maximumInputPixels: 40_000_000,
  outputWidth: 768,
  webpQuality: 82,
} as const;

const contentTypeByFormat = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

type SupportedImageFormat = keyof typeof contentTypeByFormat;

export type ProcessedImage = Readonly<{
  bytes: Uint8Array;
  contentType: "image/webp";
  height: number;
  sourceContentType: (typeof contentTypeByFormat)[SupportedImageFormat];
  width: number;
}>;

export class InvalidImageError extends Error {
  override readonly name = "InvalidImageError";
}

export class UnsupportedImageFormatError extends Error {
  override readonly name = "UnsupportedImageFormatError";
}

export class ImageTooLargeError extends Error {
  override readonly name = "ImageTooLargeError";
}

export type ImageProcessingOptions = Readonly<{
  maximumInputBytes?: number;
  maximumInputPixels?: number;
  outputWidth?: number;
  webpQuality?: number;
}>;

function isSupportedFormat(format: string | undefined): format is SupportedImageFormat {
  return format !== undefined && Object.hasOwn(contentTypeByFormat, format);
}

export async function processUploadedImage(
  input: Uint8Array,
  {
    maximumInputBytes = IMAGE_PROCESSING_LIMITS.maximumInputBytes,
    maximumInputPixels = IMAGE_PROCESSING_LIMITS.maximumInputPixels,
    outputWidth = IMAGE_PROCESSING_LIMITS.outputWidth,
    webpQuality = IMAGE_PROCESSING_LIMITS.webpQuality,
  }: ImageProcessingOptions = {},
): Promise<ProcessedImage> {
  if (input.byteLength === 0) {
    throw new InvalidImageError("Uploaded image is empty.");
  }

  if (input.byteLength > maximumInputBytes) {
    throw new ImageTooLargeError("Uploaded image exceeds the byte limit.");
  }

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;

  try {
    metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: maximumInputPixels,
    }).metadata();
  } catch {
    throw new InvalidImageError("Uploaded file could not be decoded as an image.");
  }

  if (!isSupportedFormat(metadata.format)) {
    throw new UnsupportedImageFormatError("Uploaded image format is not supported.");
  }

  try {
    const { data, info } = await sharp(input, {
      failOn: "error",
      limitInputPixels: maximumInputPixels,
    })
      .rotate()
      .resize({
        fit: "inside",
        height: outputWidth,
        width: outputWidth,
        withoutEnlargement: true,
      })
      .webp({ quality: webpQuality })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: data,
      contentType: "image/webp",
      height: info.height,
      sourceContentType: contentTypeByFormat[metadata.format],
      width: info.width,
    };
  } catch {
    throw new InvalidImageError("Uploaded image processing failed.");
  }
}
