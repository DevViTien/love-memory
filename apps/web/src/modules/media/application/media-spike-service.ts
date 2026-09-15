import { randomUUID } from "node:crypto";

import {
  UPLOAD_LIMITS,
  UploadContentTypeSchema,
  type UploadCompleteData,
  type UploadCompleteRequest,
  type UploadInitData,
  type UploadInitRequest,
} from "@love-memory/contracts";
import { processUploadedImage, type ProcessedImage } from "@love-memory/media";
import { type ObjectStorage } from "@love-memory/storage";

export class UploadVerificationError extends Error {
  override readonly name = "UploadVerificationError";
}

export type MediaSpikeServiceDependencies = Readonly<{
  createId?: () => string;
  processImage?: (input: Uint8Array) => Promise<ProcessedImage>;
  storage: ObjectStorage;
}>;

function getSourceKey(assetId: string): string {
  return `private/spikes/${assetId}/source`;
}

function getDerivativeKey(assetId: string): string {
  return `processed/spikes/${assetId}/w768.webp`;
}

export function createMediaSpikeService({
  createId = randomUUID,
  processImage = processUploadedImage,
  storage,
}: MediaSpikeServiceDependencies) {
  return {
    completeUpload: async ({ assetId }: UploadCompleteRequest): Promise<UploadCompleteData> => {
      const sourceKey = getSourceKey(assetId);
      const metadata = await storage.getObjectMetadata(sourceKey);

      if (
        metadata.contentLength <= 0 ||
        !UploadContentTypeSchema.safeParse(metadata.contentType).success ||
        metadata.contentLength > UPLOAD_LIMITS.imageMaxBytes
      ) {
        await storage.deleteObject(sourceKey);
        throw new UploadVerificationError("Uploaded object metadata is invalid.");
      }

      const bytes = await storage.getObject(sourceKey, UPLOAD_LIMITS.imageMaxBytes);
      let processed: ProcessedImage;

      try {
        processed = await processImage(bytes);
      } catch (error) {
        await storage.deleteObject(sourceKey);
        throw error;
      }

      if (processed.sourceContentType !== metadata.contentType) {
        await storage.deleteObject(sourceKey);
        throw new UploadVerificationError("Declared image type did not match decoded content.");
      }

      const derivativeKey = getDerivativeKey(assetId);
      await storage.putObject({
        body: processed.bytes,
        cacheControlMaxAge: 60,
        contentType: processed.contentType,
        key: derivativeKey,
      });
      await storage.deleteObject(sourceKey);

      return {
        assetId,
        contentType: processed.contentType,
        downloadUrl: await storage.createDownloadUrl(derivativeKey),
        height: processed.height,
        width: processed.width,
      };
    },

    initializeUpload: async ({
      contentType,
      sizeBytes,
    }: UploadInitRequest): Promise<UploadInitData> => {
      const assetId = createId();
      const upload = await storage.createUpload({
        contentType,
        expiresInSeconds: UPLOAD_LIMITS.uploadUrlTtlSeconds,
        key: getSourceKey(assetId),
        maximumSizeInBytes: sizeBytes,
      });

      return {
        assetId,
        expiresAt: upload.expiresAt.toISOString(),
        headers: upload.headers,
        method: upload.method,
        uploadUrl: upload.url,
      };
    },
  } as const;
}

export type MediaSpikeService = ReturnType<typeof createMediaSpikeService>;
