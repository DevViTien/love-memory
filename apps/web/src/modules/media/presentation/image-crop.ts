export type CropRectangle = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

const MAXIMUM_CROPPED_DIMENSION = 2_048;

export function parseAspectRatio(value: string): number {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) throw new RangeError("Expected a width:height aspect ratio.");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= 0 || height <= 0) throw new RangeError("Aspect ratio values must be positive.");
  return width / height;
}

export function calculateCropRectangle(
  sourceWidth: number,
  sourceHeight: number,
  targetAspectRatio: number,
  focalX: number,
  focalY: number,
): CropRectangle {
  if (
    ![sourceWidth, sourceHeight, targetAspectRatio].every(Number.isFinite) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetAspectRatio <= 0
  ) {
    throw new RangeError("Crop dimensions and aspect ratio must be positive.");
  }
  const normalizedX = Math.min(1, Math.max(0, focalX));
  const normalizedY = Math.min(1, Math.max(0, focalY));
  const sourceAspectRatio = sourceWidth / sourceHeight;
  if (sourceAspectRatio > targetAspectRatio) {
    const width = sourceHeight * targetAspectRatio;
    return { height: sourceHeight, width, x: (sourceWidth - width) * normalizedX, y: 0 };
  }
  const height = sourceWidth / targetAspectRatio;
  return { height, width: sourceWidth, x: 0, y: (sourceHeight - height) * normalizedY };
}

// Browsers without WebP canvas encoding (Safari, so every iOS browser) silently return PNG. The crop
// is then encoded again as JPEG, because a lossless 2048px PNG is several megabytes. The upload must
// declare what was actually encoded, or processing rejects the MIME mismatch as UPLOAD_INVALID.
const ENCODED_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type EncodedContentType = keyof typeof ENCODED_EXTENSIONS;

export function encodedContentType(blobType: string): EncodedContentType {
  return blobType === "image/png" || blobType === "image/jpeg" ? blobType : "image/webp";
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result ? resolve(result) : reject(new Error("The cropped image could not be encoded.")),
      type,
      quality,
    );
  });
}

function croppedFileName(name: string, contentType: EncodedContentType): string {
  const base = name.replace(/\.[^.]+$/, "") || "memory";
  return `${base}-cropped.${ENCODED_EXTENSIONS[contentType]}`;
}

export async function cropImageToAspectRatio(
  file: File,
  aspectRatio: string,
  focalX: number,
  focalY: number,
): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    const crop = calculateCropRectangle(
      bitmap.width,
      bitmap.height,
      parseAspectRatio(aspectRatio),
      focalX,
      focalY,
    );
    const scale = Math.min(
      1,
      MAXIMUM_CROPPED_DIMENSION / crop.width,
      MAXIMUM_CROPPED_DIMENSION / crop.height,
    );
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare the image crop.");
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    let blob = await encodeCanvas(canvas, "image/webp", 0.9);
    if (encodedContentType(blob.type) !== "image/webp") {
      blob = await encodeCanvas(canvas, "image/jpeg", 0.9);
    }
    const contentType = encodedContentType(blob.type);
    return new File([blob], croppedFileName(file.name, contentType), {
      lastModified: file.lastModified,
      type: contentType,
    });
  } finally {
    bitmap.close();
    // Release the backing store now; iOS caps total canvas memory per page.
    canvas.width = 0;
    canvas.height = 0;
  }
}
