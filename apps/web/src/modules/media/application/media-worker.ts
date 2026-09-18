import {
  MEDIA_ASSET_LIMITS,
  type MediaAsset,
  type MediaAssetDerivative,
} from "@love-memory/domain";
import {
  ImageTooLargeError,
  InvalidImageError,
  processUploadedImageSet,
  UnsupportedImageFormatError,
} from "@love-memory/media";
import {
  ObjectNotFoundError,
  StoredObjectTooLargeError,
  type ObjectStorage,
} from "@love-memory/storage";

export type ClaimedMediaJob = Readonly<{ asset: MediaAsset; jobId: string }>;

export interface MediaWorkerRepository {
  claimNext: (now: Date) => Promise<ClaimedMediaJob | null>;
  claimExpiredUpload: (now: Date) => Promise<MediaAsset | null>;
  complete: (
    assetId: string,
    jobId: string,
    output: Readonly<{
      checksumSha256: string;
      derivatives: readonly MediaAssetDerivative[];
      placeholderDataUrl: string;
    }>,
    now: Date,
  ) => Promise<void>;
  fail: (
    assetId: string,
    jobId: string,
    failureCode: NonNullable<MediaAsset["failureCode"]>,
    retryAt: Date | null,
    now: Date,
  ) => Promise<void>;
  finishExpiredCleanup: (assetId: string, now: Date) => Promise<void>;
  failExpiredCleanup: (assetId: string, now: Date) => Promise<void>;
}

type Dependencies = Readonly<{
  clock?: () => Date;
  processImage?: typeof processUploadedImageSet;
  reportCleanupFailure?: (error: unknown, assetId: string) => void;
  reportProcessingFailure?: (error: unknown, assetId: string) => void;
  repository: MediaWorkerRepository;
  storage: ObjectStorage;
}>;

export function createMediaWorker({
  clock = () => new Date(),
  processImage = processUploadedImageSet,
  reportCleanupFailure = () => undefined,
  reportProcessingFailure = () => undefined,
  repository,
  storage,
}: Dependencies) {
  function nonRetryableFailureCode(error: unknown): NonNullable<MediaAsset["failureCode"]> | null {
    if (error instanceof ObjectNotFoundError) return "OBJECT_MISSING";
    if (error instanceof StoredObjectTooLargeError || error instanceof ImageTooLargeError) {
      return "UPLOAD_INVALID";
    }
    if (error instanceof InvalidImageError || error instanceof UnsupportedImageFormatError) {
      return "DECODE_FAILED";
    }
    return null;
  }

  async function deleteSourceBestEffort(asset: MediaAsset) {
    try {
      await storage.deleteObject(asset.sourceKey);
    } catch (error) {
      reportCleanupFailure(error, asset.id);
    }
  }

  async function runExpiredCleanup(): Promise<
    Readonly<{ assetId?: string; status: "cleaned" | "failed" | "idle" }>
  > {
    const expired = await repository.claimExpiredUpload(clock());
    if (!expired) return { status: "idle" };
    try {
      const cleanup = await Promise.allSettled([
        storage.deleteObject(expired.sourceKey),
        ...expired.derivatives.map((derivative) => storage.deleteObject(derivative.key)),
      ]);
      const errors = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason as unknown] : [],
      );
      if (errors.length > 0) throw new AggregateError(errors, "Asset cleanup did not complete.");
      await repository.finishExpiredCleanup(expired.id, clock());
      return { assetId: expired.id, status: "cleaned" };
    } catch (error) {
      await repository.failExpiredCleanup(expired.id, clock());
      reportCleanupFailure(error, expired.id);
      return { assetId: expired.id, status: "failed" };
    }
  }

  async function runNext(): Promise<
    Readonly<{ assetId?: string; status: "cleaned" | "completed" | "failed" | "idle" }>
  > {
    const claimed = await repository.claimNext(clock());
    if (!claimed) return runExpiredCleanup();

    const { asset, jobId } = claimed;
    const writtenDerivativeKeys: string[] = [];
    try {
      const source = await storage.getObject(asset.sourceKey, MEDIA_ASSET_LIMITS.maximumInputBytes);
      const output = await processImage(source);
      if (output.sourceContentType !== asset.declaredContentType) {
        await deleteSourceBestEffort(asset);
        await repository.fail(asset.id, jobId, "UPLOAD_INVALID", null, clock());
        return { assetId: asset.id, status: "failed" };
      }

      const derivatives = await Promise.all(
        output.derivatives.map(async (derivative) => {
          const key = `private/assets/${asset.id}/derivatives/w${derivative.targetWidth}.webp`;
          await storage.putObject({
            allowOverwrite: true,
            body: derivative.bytes,
            cacheControlMaxAge: 31_536_000,
            contentType: derivative.contentType,
            key,
          });
          writtenDerivativeKeys.push(key);
          return {
            contentType: derivative.contentType,
            height: derivative.height,
            key,
            width: derivative.width,
          } satisfies MediaAssetDerivative;
        }),
      );
      await repository.complete(
        asset.id,
        jobId,
        {
          checksumSha256: output.checksumSha256,
          derivatives,
          placeholderDataUrl: output.placeholderDataUrl,
        },
        clock(),
      );
      try {
        await storage.deleteObject(asset.sourceKey);
      } catch (error) {
        reportCleanupFailure(error, asset.id);
      }
      return { assetId: asset.id, status: "completed" };
    } catch (error) {
      const cleanup = await Promise.allSettled(
        writtenDerivativeKeys.map((key) => storage.deleteObject(key)),
      );
      for (const result of cleanup) {
        if (result.status === "rejected") reportCleanupFailure(result.reason, asset.id);
      }
      const terminalFailureCode = nonRetryableFailureCode(error);
      if (terminalFailureCode) await deleteSourceBestEffort(asset);
      const failureCode = terminalFailureCode ?? "PROCESSING_FAILED";
      const retryAt =
        !terminalFailureCode && asset.attempts < MEDIA_ASSET_LIMITS.maximumAttempts
          ? new Date(clock().getTime() + 2 ** asset.attempts * 30_000)
          : null;
      await repository.fail(asset.id, jobId, failureCode, retryAt, clock());
      reportProcessingFailure(error, asset.id);
      return { assetId: asset.id, status: "failed" };
    }
  }

  return {
    async runAvailable(maximumJobs = 10) {
      if (!Number.isSafeInteger(maximumJobs) || maximumJobs < 1 || maximumJobs > 100) {
        throw new RangeError("maximumJobs must be an integer between 1 and 100.");
      }

      const results: Awaited<ReturnType<typeof runNext>>[] = [];
      while (results.length < maximumJobs) {
        const result = await runNext();
        if (result.status === "idle") break;
        results.push(result);
      }
      return results;
    },
    runExpiredCleanup,
    runNext,
  } as const;
}

export type MediaWorker = ReturnType<typeof createMediaWorker>;
