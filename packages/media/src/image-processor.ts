import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";

export const IMAGE_PROCESSING_LIMITS = {
  maximumInputBytes: 10 * 1024 * 1024,
  maximumInputPixels: 40_000_000,
  outputWidth: 768,
  outputWidths: [320, 768, 1280],
  placeholderWidth: 24,
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

export type ProcessedImageDerivative = ProcessedImage & Readonly<{ targetWidth: number }>;

export type ProcessedImageSet = Readonly<{
  checksumSha256: string;
  derivatives: readonly ProcessedImageDerivative[];
  placeholderDataUrl: string;
  sourceContentType: (typeof contentTypeByFormat)[SupportedImageFormat];
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

export type ImageSetProcessingOptions = Omit<ImageProcessingOptions, "outputWidth"> &
  Readonly<{
    outputWidths?: readonly number[];
    placeholderWidth?: number;
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

export async function processUploadedImageSet(
  input: Uint8Array,
  {
    maximumInputBytes = IMAGE_PROCESSING_LIMITS.maximumInputBytes,
    maximumInputPixels = IMAGE_PROCESSING_LIMITS.maximumInputPixels,
    outputWidths = IMAGE_PROCESSING_LIMITS.outputWidths,
    placeholderWidth = IMAGE_PROCESSING_LIMITS.placeholderWidth,
    webpQuality = IMAGE_PROCESSING_LIMITS.webpQuality,
  }: ImageSetProcessingOptions = {},
): Promise<ProcessedImageSet> {
  const widths = [...new Set(outputWidths)].sort((left, right) => left - right);
  if (
    widths.length === 0 ||
    widths.some((width) => !Number.isSafeInteger(width) || width <= 0 || width > 4096)
  ) {
    throw new RangeError("Derivative widths must be positive integers no greater than 4096.");
  }

  const derivatives: ProcessedImageDerivative[] = [];
  for (const targetWidth of widths) {
    derivatives.push({
      ...(await processUploadedImage(input, {
        maximumInputBytes,
        maximumInputPixels,
        outputWidth: targetWidth,
        webpQuality,
      })),
      targetWidth,
    });
  }

  let placeholder: Buffer;
  try {
    placeholder = await sharp(input, {
      failOn: "error",
      limitInputPixels: maximumInputPixels,
    })
      .rotate()
      .resize({ fit: "inside", width: placeholderWidth, withoutEnlargement: true })
      .webp({ quality: 35 })
      .toBuffer();
  } catch {
    throw new InvalidImageError("Uploaded image placeholder processing failed.");
  }

  return {
    checksumSha256: createHash("sha256").update(input).digest("hex"),
    derivatives,
    placeholderDataUrl: `data:image/webp;base64,${placeholder.toString("base64")}`,
    sourceContentType: derivatives[0]!.sourceContentType,
  };
}
