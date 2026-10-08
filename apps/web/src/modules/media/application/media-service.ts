import {
  isEditableGiftStatus,
  MEDIA_ASSET_LIMITS,
  type Gift,
  type MediaAsset,
  type MediaAssetDerivative,
} from "@love-memory/domain";
import { ObjectNotFoundError, type ObjectStorage } from "@love-memory/storage";
import { isImageField, type TemplateManifest } from "@love-memory/template-sdk";

import { type GiftAccessor } from "@/modules/gifts/application/gift-service";

export const MEDIA_UPLOAD_TTL_MILLISECONDS = 10 * 60 * 1000;

export type MediaServiceError = Readonly<
  | { code: "INVALID_FIELD" }
  | { code: "INVALID_STATE" }
  | { code: "NOT_FOUND" }
  | { code: "QUOTA_EXCEEDED" }
  | { code: "RETRY_EXHAUSTED" }
  | { code: "UPLOAD_INVALID" }
>;

export type MediaServiceResult<T> =
  Readonly<{ data: T; ok: true }> | Readonly<{ error: MediaServiceError; ok: false }>;

export interface MediaAssetRepository {
  createWithinQuota: (
    asset: MediaAsset,
    maximumAssetsForGift: number,
    maximumAssetsForField: number,
  ) => Promise<boolean>;
  releaseInitiated: (assetId: string, now: Date) => Promise<boolean>;
  findById: (assetId: string) => Promise<MediaAsset | null>;
  /** The gift's working-copy assets: every non-`deleted` asset that is not detached. */
  listByGiftId: (giftId: string) => Promise<readonly MediaAsset[]>;
  /**
   * Exactly these assets of the gift (a publication snapshot), filtered by the gift id. Detached
   * assets are included: a publication may still show them.
   */
  listByIdsForGift: (giftId: string, assetIds: readonly string[]) => Promise<readonly MediaAsset[]>;
  markDeleted: (assetId: string, now: Date) => Promise<boolean>;
  /**
   * In one transaction with the read of its gift (still `draft` or `published`) and of the gift's
   * current publication: detaches the asset when that publication references it, otherwise moves
   * it to `deleting`. A deletion can therefore never interleave with a publish of that gift.
   */
  markDeleting: (assetId: string, giftId: string, now: Date) => Promise<MarkDeletingResult>;
  markFailed: (
    assetId: string,
    failureCode: NonNullable<MediaAsset["failureCode"]>,
    now: Date,
  ) => Promise<boolean>;
  markUploadedAndEnqueue: (assetId: string, now: Date) => Promise<MediaAsset | null>;
  requeue: (assetId: string, now: Date) => Promise<MediaAsset | null>;
}

export type MarkDeletingResult =
  | Readonly<{ asset: MediaAsset; kind: "deleting" }>
  /** Kept for the current publication's recipients, out of the working copy and its quotas. */
  | Readonly<{ kind: "detached" }>
  | Readonly<{ kind: "asset-unavailable" }>
  | Readonly<{ kind: "gift-not-editable" }>;

export type MediaAssetDto = Readonly<{
  assetId: string;
  derivatives: readonly Readonly<{ height: number; url: string; width: number }>[];
  failureCode: string | null;
  fieldId: string;
  placeholderDataUrl: string | null;
  status: MediaAsset["status"];
}>;

type Dependencies = Readonly<{
  assets: MediaAssetRepository;
  authorizeGift: (publicId: string, accessors: readonly GiftAccessor[]) => Promise<Gift | null>;
  clock?: () => Date;
  createId?: () => string;
  findManifest: (templateId: string, version: string) => Promise<TemplateManifest | null>;
  storage: ObjectStorage;
}>;

function success<T>(data: T): MediaServiceResult<T> {
  return { data, ok: true };
}

function failure(error: MediaServiceError): MediaServiceResult<never> {
  return { error, ok: false };
}

/** Statuses that a completion has already reached: completing again answers with the DTO. */
const completedStatuses: ReadonlySet<MediaAsset["status"]> = new Set([
  "uploaded",
  "processing",
  "ready",
]);

function isAuthorizedAsset(asset: MediaAsset, gift: Gift): boolean {
  // Media operations act on the editable content: a draft's, or a published gift's working copy.
  // A detached asset belongs only to a publication, whose URLs the public Viewer alone signs.
  return (
    isEditableGiftStatus(gift.status) &&
    asset.giftId === gift.id &&
    asset.status !== "deleted" &&
    asset.detachedAt === null
  );
}

export function createMediaService({
  assets,
  authorizeGift,
  clock = () => new Date(),
  createId = () => crypto.randomUUID(),
  findManifest,
  storage,
}: Dependencies) {
  async function findAuthorizedAsset(
    assetId: string,
    giftPublicId: string,
    accessors: readonly GiftAccessor[],
  ): Promise<Readonly<{ asset: MediaAsset; gift: Gift }> | null> {
    const [asset, gift] = await Promise.all([
      assets.findById(assetId),
      authorizeGift(giftPublicId, accessors),
    ]);
    return asset && gift && isAuthorizedAsset(asset, gift) ? { asset, gift } : null;
  }

  async function derivativeDto(derivative: MediaAssetDerivative) {
    return {
      height: derivative.height,
      url: await storage.createDownloadUrl(derivative.key),
      width: derivative.width,
    };
  }

  async function toDto(asset: MediaAsset, includeDownloadUrls = true): Promise<MediaAssetDto> {
    return {
      assetId: asset.id,
      derivatives:
        asset.status === "ready" && includeDownloadUrls
          ? await Promise.all(asset.derivatives.map(derivativeDto))
          : [],
      failureCode: asset.failureCode,
      fieldId: asset.fieldId,
      placeholderDataUrl: asset.placeholderDataUrl,
      status: asset.status,
    };
  }

  /**
   * The asset left `initiated` while this completion was running. When a concurrent completion of
   * the same asset won, completion is idempotent: answer with the current DTO. Only the winning
   * transaction enqueued a job, so nothing is enqueued twice.
   */
  async function concurrentCompletionOutcome(
    assetId: string,
  ): Promise<MediaServiceResult<MediaAssetDto>> {
    const current = await assets.findById(assetId);
    return current && completedStatuses.has(current.status)
      ? success(await toDto(current))
      : failure({ code: "INVALID_STATE" });
  }

  return {
    async completeUpload(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        assetId: string;
        giftPublicId: string;
      }>,
    ): Promise<MediaServiceResult<MediaAssetDto>> {
      const authorized = await findAuthorizedAsset(
        input.assetId,
        input.giftPublicId,
        input.accessors,
      );
      if (!authorized) return failure({ code: "NOT_FOUND" });
      if (authorized.asset.status !== "initiated") {
        return completedStatuses.has(authorized.asset.status)
          ? success(await toDto(authorized.asset))
          : failure({ code: "INVALID_STATE" });
      }

      let metadata: Awaited<ReturnType<ObjectStorage["getObjectMetadata"]>>;
      try {
        metadata = await storage.getObjectMetadata(authorized.asset.sourceKey);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          const failed = await assets.markFailed(authorized.asset.id, "OBJECT_MISSING", clock());
          return failed
            ? failure({ code: "UPLOAD_INVALID" })
            : concurrentCompletionOutcome(authorized.asset.id);
        }
        throw error;
      }

      if (
        metadata.contentLength !== authorized.asset.declaredSizeBytes ||
        metadata.contentType.toLowerCase() !== authorized.asset.declaredContentType
      ) {
        const failed = await assets.markFailed(authorized.asset.id, "UPLOAD_INVALID", clock());
        if (!failed) return concurrentCompletionOutcome(authorized.asset.id);
        await storage.deleteObject(authorized.asset.sourceKey).catch(() => undefined);
        return failure({ code: "UPLOAD_INVALID" });
      }

      const uploaded = await assets.markUploadedAndEnqueue(authorized.asset.id, clock());
      return uploaded
        ? success(await toDto(uploaded))
        : concurrentCompletionOutcome(authorized.asset.id);
    },

    async deleteAsset(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        assetId: string;
        giftPublicId: string;
      }>,
    ): Promise<MediaServiceResult<{ assetId: string; deleted: boolean }>> {
      const authorized = await findAuthorizedAsset(
        input.assetId,
        input.giftPublicId,
        input.accessors,
      );
      if (!authorized) return failure({ code: "NOT_FOUND" });
      const marked = await assets.markDeleting(input.assetId, authorized.gift.id, clock());
      // Left the editable statuses between the check above and the write: the same opaque 404.
      if (marked.kind === "gift-not-editable") return failure({ code: "NOT_FOUND" });
      if (marked.kind === "asset-unavailable") return failure({ code: "INVALID_STATE" });
      // The current publication still shows it: nothing is removed from storage.
      if (marked.kind === "detached") return success({ assetId: input.assetId, deleted: false });
      const deleting = marked.asset;

      const cleanup = await Promise.allSettled([
        storage.deleteObject(deleting.sourceKey),
        ...deleting.derivatives.map((derivative) => storage.deleteObject(derivative.key)),
      ]);
      if (cleanup.some((result) => result.status === "rejected")) {
        const errors = cleanup.reduce<unknown[]>((current, result) => {
          if (result.status === "rejected") current.push(result.reason as unknown);
          return current;
        }, []);
        throw new AggregateError(errors, "Asset cleanup did not complete.");
      }
      const deleted = await assets.markDeleted(input.assetId, clock());
      return deleted
        ? success({ assetId: input.assetId, deleted: true })
        : failure({ code: "INVALID_STATE" });
    },

    async getAsset(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        assetId: string;
        giftPublicId: string;
      }>,
    ): Promise<MediaServiceResult<MediaAssetDto>> {
      const authorized = await findAuthorizedAsset(
        input.assetId,
        input.giftPublicId,
        input.accessors,
      );
      return authorized ? success(await toDto(authorized.asset)) : failure({ code: "NOT_FOUND" });
    },

    async initializeUpload(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        contentType: MediaAsset["declaredContentType"];
        fieldId: string;
        giftPublicId: string;
        sizeBytes: number;
      }>,
    ): Promise<
      MediaServiceResult<
        Readonly<{
          assetId: string;
          expiresAt: string;
          headers: Readonly<Record<string, string>>;
          method: "PUT";
          url: string;
        }>
      >
    > {
      const gift = await authorizeGift(input.giftPublicId, input.accessors);
      if (!gift || !isEditableGiftStatus(gift.status)) return failure({ code: "NOT_FOUND" });
      const manifest = await findManifest(gift.content.templateId, gift.content.templateVersion);
      const field = manifest?.fields.find((candidate) => candidate.id === input.fieldId);
      if (!field || !isImageField(field)) return failure({ code: "INVALID_FIELD" });

      const id = createId();
      const now = clock();
      const sourceKey = `private/assets/${id}/source`;
      const expiresAt = new Date(now.getTime() + MEDIA_UPLOAD_TTL_MILLISECONDS);
      const asset: MediaAsset = {
        anonymousDraftId: gift.ownership.anonymousDraftId,
        attempts: 0,
        checksumSha256: null,
        createdAt: now,
        declaredContentType: input.contentType,
        declaredSizeBytes: input.sizeBytes,
        derivatives: [],
        detachedAt: null,
        expiresAt,
        failureCode: null,
        fieldId: field.id,
        fieldSlot: null,
        giftId: gift.id,
        giftSlot: null,
        id,
        ownerId: gift.ownership.ownerId,
        placeholderDataUrl: null,
        sourceKey,
        status: "initiated",
        updatedAt: now,
      };
      const reserved = await assets.createWithinQuota(
        asset,
        MEDIA_ASSET_LIMITS.maximumAssetsPerGift,
        field.maxItems,
      );
      if (!reserved) return failure({ code: "QUOTA_EXCEEDED" });
      let upload: Awaited<ReturnType<ObjectStorage["createUpload"]>>;
      try {
        upload = await storage.createUpload({
          contentType: input.contentType,
          expiresInSeconds: MEDIA_UPLOAD_TTL_MILLISECONDS / 1000,
          key: sourceKey,
          maximumSizeInBytes: input.sizeBytes,
        });
      } catch (uploadError) {
        try {
          const released = await assets.releaseInitiated(id, clock());
          if (!released) throw new Error("Upload reservation left the initiated state.");
        } catch (releaseError) {
          throw new AggregateError(
            [uploadError, releaseError],
            "Upload grant failed and its quota reservation could not be released.",
          );
        }
        throw uploadError;
      }
      return success({
        assetId: id,
        expiresAt: upload.expiresAt.toISOString(),
        headers: upload.headers,
        method: upload.method,
        url: upload.url,
      });
    },

    async listAssets(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        giftPublicId: string;
        includeDownloadUrls?: boolean;
      }>,
    ): Promise<MediaServiceResult<readonly MediaAssetDto[]>> {
      const gift = await authorizeGift(input.giftPublicId, input.accessors);
      if (!gift || !isEditableGiftStatus(gift.status)) return failure({ code: "NOT_FOUND" });
      return success(
        await Promise.all(
          (await assets.listByGiftId(gift.id)).map((asset) =>
            toDto(asset, input.includeDownloadUrls ?? true),
          ),
        ),
      );
    },

    async retryAsset(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        assetId: string;
        giftPublicId: string;
      }>,
    ): Promise<MediaServiceResult<MediaAssetDto>> {
      const authorized = await findAuthorizedAsset(
        input.assetId,
        input.giftPublicId,
        input.accessors,
      );
      if (!authorized) return failure({ code: "NOT_FOUND" });
      if (authorized.asset.status !== "failed") return failure({ code: "INVALID_STATE" });
      if (authorized.asset.failureCode !== "PROCESSING_FAILED") {
        return failure({ code: "INVALID_STATE" });
      }
      if (authorized.asset.attempts >= MEDIA_ASSET_LIMITS.maximumAttempts) {
        return failure({ code: "RETRY_EXHAUSTED" });
      }
      const asset = await assets.requeue(input.assetId, clock());
      return asset ? success(await toDto(asset)) : failure({ code: "INVALID_STATE" });
    },
  } as const;
}

export type MediaService = ReturnType<typeof createMediaService>;
