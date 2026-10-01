import { type AnalyticsContext, type LicensedAudioTrackDto } from "@love-memory/contracts";
import {
  createGiftDraft,
  createGiftPublication,
  type Gift,
  type GiftPublication,
  type MediaAsset,
  publishGiftDraft,
  updateGiftDraft,
} from "@love-memory/domain";
import {
  listImageFieldReferences,
  parseTemplateDraftPayload,
  type TemplateManifest,
} from "@love-memory/template-sdk";
import { z } from "zod";

import {
  collectContentIssues,
  issuesToFieldErrors,
  toViewerFields,
} from "@/modules/viewer/application/content-issues";

export type GiftAccessor =
  | Readonly<{ kind: "user"; userId: string }>
  | Readonly<{ anonymousDraftId: string; claimTokenHash: string; kind: "anonymous" }>;

export type AnonymousDraftIdentity = Readonly<{
  anonymousDraftId: string;
  claimToken: string;
  claimTokenHash: string;
}>;

export type GiftCreateIdempotency = Readonly<{
  accessor: GiftAccessor;
  actorKey: string;
  expiresAt: Date;
  key: string;
  requestFingerprint: string;
  scope: "gift-create";
}>;

export type GiftCreatePersistenceResult =
  Readonly<{ gift: Gift; status: "created" | "replayed" }> | Readonly<{ status: "conflict" }>;

/** A `gift-publish` idempotency record: recorded only by a successful publish, kept 24 hours. */
export type GiftPublishIdempotency = Readonly<{
  actorKey: string;
  expiresAt: Date;
  key: string;
  requestFingerprint: string;
  scope: "gift-publish";
}>;

/** A stored publish key: the same request gets its publication back, anything else conflicts. */
export type GiftPublishReplay =
  | Readonly<{ publication: GiftPublication; status: "replayed" }>
  | Readonly<{ status: "idempotency-conflict" }>;

export type GiftPublishPersistenceResult =
  | GiftPublishReplay
  | Readonly<{ publication: GiftPublication; status: "published" }>
  | Readonly<{ status: "assets-changed" }>
  | Readonly<{ status: "stale" }>;

export type GiftPublishInput = Readonly<{
  /** Every image reference of the content, grouped by field; each must still be `ready`. */
  assetRefs: readonly GiftMediaReferenceGroup[];
  expectedRevision: number;
  /** The gift in its published state, as `publishGiftDraft` returned it. */
  gift: Gift;
  idempotency: GiftPublishIdempotency;
  ownerId: string;
  publication: GiftPublication;
}>;

export type GiftMediaReferenceGroup = Readonly<{
  assetIds: readonly string[];
  fieldId: string;
}>;

export interface GiftRepository {
  claimDraft(
    publicId: string,
    ownerId: string,
    anonymousDraftId: string,
    claimTokenHash: string,
    now: Date,
  ): Promise<Gift | null>;
  createDraft(gift: Gift, idempotency: GiftCreateIdempotency): Promise<GiftCreatePersistenceResult>;
  findAuthorized(publicId: string, accessors: readonly GiftAccessor[]): Promise<Gift | null>;
  /**
   * Reads a gift by internal id only while it is a `draft`. Used only after a valid preview token
   * named the gift; it grants nothing by itself.
   */
  findDraftById(giftId: string): Promise<Gift | null>;
  /**
   * A published, `unlisted` gift by its share id. Used only by the public Viewer: the share id is
   * the recipient's credential.
   */
  findPublishedByShareId(shareId: string): Promise<Gift | null>;
  /** The stored `gift-publish` key, if any, compared with this request. */
  findPublishReplay(
    idempotency: GiftPublishIdempotency,
    giftId: string,
  ): Promise<GiftPublishReplay | null>;
  /**
   * One transaction: the conditional `draft → published` write, a write to every referenced
   * `ready` asset, the publication record and the idempotency key, or nothing at all.
   */
  publishDraft(input: GiftPublishInput): Promise<GiftPublishPersistenceResult>;
  validateMediaReferences(
    giftId: string,
    references: readonly GiftMediaReferenceGroup[],
  ): Promise<boolean>;
  updateDraft(
    gift: Gift,
    expectedRevision: number,
    accessors: readonly GiftAccessor[],
  ): Promise<Gift | null>;
}

export interface GiftAudioCatalog {
  findSelectableTrack(id: string): LicensedAudioTrackDto | null;
  isSelectableTrack(id: string): boolean;
}

export interface GiftPublicationRepository {
  findByShareId(shareId: string): Promise<GiftPublication | null>;
}

/** The internal free entitlement today; a verified-payment entitlement in Sprint 4 (ADR-0009). */
export interface PublishEntitlement {
  canPublish(ownerId: string): boolean;
}

/** The registered template artifact of an exact version, or `null` when none is registered. */
export interface GiftArtifactResolver {
  resolve(templateId: string, version: string): Readonly<{ contentHash: string }> | null;
}

/** The gift fields analytics may see: never content, the public id or the share id. */
export type AnalyticsGiftIdentity = Readonly<{
  id: string;
  templateId: string;
  templateVersion: string;
}>;

/** The page analytics context of an authorized gift, or `null` while analytics is disabled. */
export type AnalyticsContextFactory = (gift: AnalyticsGiftIdentity) => AnalyticsContext | null;

/**
 * Records `gift_published` for a first publish. Synchronous and fire-and-forget: the service never
 * waits on it, and a failure never changes the publish result.
 */
export type PublishAnalytics = Readonly<{
  giftPublished: (
    input: Readonly<{
      giftId: string;
      requestId: string;
      templateId: string;
      templateVersion: string;
    }>,
  ) => void;
}>;

export type GiftAnalyticsDependencies = Readonly<{
  contextForGift: AnalyticsContextFactory;
  publish: PublishAnalytics;
}>;

export type GiftPublishingDependencies = Readonly<{
  artifacts: GiftArtifactResolver;
  assets: Readonly<{ listByGiftId: (giftId: string) => Promise<readonly MediaAsset[]> }>;
  createShareId: () => string;
  entitlement: PublishEntitlement;
}>;

export interface GiftTemplateRepository {
  findCreatableManifest(templateId: string, version: string): Promise<TemplateManifest | null>;
  findEditableManifest(templateId: string, version: string): Promise<TemplateManifest | null>;
}

export type GiftServiceError = Readonly<
  | { code: "NOT_FOUND" }
  | { code: "NOT_AUTHENTICATED" }
  | { code: "IDEMPOTENCY_CONFLICT" }
  | { code: "INVALID_CONTENT"; fieldErrors: Readonly<Record<string, string>> }
  | { code: "INVALID_STATE" }
  | { actualRevision: number; code: "REVISION_CONFLICT"; expectedRevision: number }
  | { code: "FORBIDDEN" }
  | { code: "ACCESS_POLICY_UNSUPPORTED" }
  | { code: "TEMPLATE_NOT_EDITABLE" }
  | { code: "TEMPLATE_UNPUBLISHABLE" }
>;

export type GiftServiceResult<T> =
  Readonly<{ data: T; ok: true }> | Readonly<{ error: GiftServiceError; ok: false }>;

export type GiftDraftDto = Readonly<{
  content: Readonly<Record<string, unknown>>;
  createdAt: string;
  ownerKind: "anonymous" | "user";
  publicId: string;
  revision: number;
  status: "draft";
  templateId: string;
  templateVersion: string;
  updatedAt: string;
}>;

export type GiftPublicationDto = Readonly<{
  publicId: string;
  publishedAt: string;
  revision: number;
  shareId: string;
  sharePath: string;
  status: "published";
}>;

/** What the Studio shows for an authorized gift: the editor, or the published panel. */
export type StudioGiftView =
  | Readonly<{ analytics: AnalyticsContext | null; draft: GiftDraftDto; kind: "draft" }>
  | Readonly<{ kind: "published"; publication: GiftPublicationDto }>;

export const PUBLISH_IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

export type GiftServiceDependencies = Readonly<{
  /** Funnel analytics ports; without them the service behaves as with analytics disabled. */
  analytics?: GiftAnalyticsDependencies;
  audioTracks: GiftAudioCatalog;
  clock: () => Date;
  createAnonymousIdentity: (idempotencyKey: string) => AnonymousDraftIdentity;
  createId: () => string;
  createPublicId: () => string;
  gifts: GiftRepository;
  /** Required by `publishGift` only. */
  publishing?: GiftPublishingDependencies;
  templates: GiftTemplateRepository;
}>;

function success<T>(data: T): GiftServiceResult<T> {
  return { data, ok: true };
}

function failure(error: GiftServiceError): GiftServiceResult<never> {
  return { error, ok: false };
}

function toDto(gift: Gift): GiftDraftDto {
  if (gift.status !== "draft") {
    throw new Error("Only draft gifts can be represented by GiftDraftDto.");
  }

  return {
    content: gift.content.data,
    createdAt: gift.createdAt.toISOString(),
    ownerKind: gift.ownership.ownerId === null ? "anonymous" : "user",
    publicId: gift.publicId,
    revision: gift.revision,
    status: gift.status,
    templateId: gift.content.templateId,
    templateVersion: gift.content.templateVersion,
    updatedAt: gift.updatedAt.toISOString(),
  };
}

function toPublicationDto(
  publicId: string,
  publication: Pick<GiftPublication, "publishedAt" | "revision" | "shareId">,
): GiftPublicationDto {
  return {
    publicId,
    publishedAt: publication.publishedAt.toISOString(),
    revision: publication.revision,
    shareId: publication.shareId,
    sharePath: `/g/${publication.shareId}`,
    status: "published",
  };
}

function uniqueAssetIds(references: readonly GiftMediaReferenceGroup[]): string[] {
  return [...new Set(references.flatMap((reference) => reference.assetIds))];
}

function assetState(asset: MediaAsset | undefined): string {
  return asset ? `${asset.giftId}|${asset.fieldId}|${asset.status}` : "missing";
}

/**
 * The image fields whose referenced assets changed between the publish checks and the transaction.
 * Every field is named only when no difference is visible any more, so the answer is never empty.
 */
export function changedImageFieldErrors(
  references: readonly GiftMediaReferenceGroup[],
  before: readonly MediaAsset[],
  after: readonly MediaAsset[],
): Readonly<Record<string, string>> {
  const beforeById = new Map(before.map((asset) => [asset.id, asset]));
  const afterById = new Map(after.map((asset) => [asset.id, asset]));
  const changed = references.filter(({ assetIds }) =>
    assetIds.some(
      (assetId) => assetState(beforeById.get(assetId)) !== assetState(afterById.get(assetId)),
    ),
  );
  return Object.fromEntries(
    (changed.length > 0 ? changed : references).map(({ fieldId }) => [
      fieldId,
      "This image is not ready.",
    ]),
  );
}

function toFieldErrors(error: z.ZodError): Readonly<Record<string, string>> {
  return Object.fromEntries(
    error.issues.map((issue) => [issue.path.join(".") || "content", issue.message]),
  );
}

export function createGiftService(dependencies: GiftServiceDependencies) {
  return {
    async claimDraft(
      input: Readonly<{
        anonymousDraftId: string | null;
        claimTokenHash: string | null;
        publicId: string;
        userId: string | null;
      }>,
    ): Promise<GiftServiceResult<GiftDraftDto>> {
      if (!input.userId) {
        return failure({ code: "NOT_AUTHENTICATED" });
      }

      if (!input.anonymousDraftId || !input.claimTokenHash) {
        return failure({ code: "NOT_FOUND" });
      }

      const claimed = await dependencies.gifts.claimDraft(
        input.publicId,
        input.userId,
        input.anonymousDraftId,
        input.claimTokenHash,
        dependencies.clock(),
      );

      return claimed ? success(toDto(claimed)) : failure({ code: "NOT_FOUND" });
    },

    async createDraft(
      input: Readonly<{
        anonymousIdentity?: AnonymousDraftIdentity;
        idempotencyKey: string;
        ownerId: string | null;
        templateId: string;
        templateVersion: string;
      }>,
    ): Promise<
      GiftServiceResult<
        Readonly<{ anonymousIdentity: AnonymousDraftIdentity | null; gift: GiftDraftDto }>
      >
    > {
      const manifest = await dependencies.templates.findCreatableManifest(
        input.templateId,
        input.templateVersion,
      );
      if (!manifest) {
        return failure({ code: "NOT_FOUND" });
      }
      // A version without a registered artifact can be neither previewed nor published, so no new
      // draft is created on it (it is shown as "Sắp ra mắt" in the catalog).
      if (
        dependencies.publishing &&
        !dependencies.publishing.artifacts.resolve(manifest.id, manifest.version)
      ) {
        return failure({ code: "NOT_FOUND" });
      }

      const anonymousIdentity = input.ownerId
        ? null
        : (input.anonymousIdentity ?? dependencies.createAnonymousIdentity(input.idempotencyKey));
      const accessor: GiftAccessor = input.ownerId
        ? { kind: "user", userId: input.ownerId }
        : {
            anonymousDraftId: anonymousIdentity!.anonymousDraftId,
            claimTokenHash: anonymousIdentity!.claimTokenHash,
            kind: "anonymous",
          };
      const draft = createGiftDraft({
        anonymousDraftId: anonymousIdentity?.anonymousDraftId ?? null,
        claimTokenHash: anonymousIdentity?.claimTokenHash ?? null,
        content: {
          data: {},
          schemaVersion: 1,
          templateId: manifest.id,
          templateVersion: manifest.version,
        },
        id: dependencies.createId(),
        now: dependencies.clock(),
        ownerId: input.ownerId,
        publicId: dependencies.createPublicId(),
      });

      const persisted = await dependencies.gifts.createDraft(draft, {
        accessor,
        actorKey: input.ownerId
          ? `user:${input.ownerId}`
          : `anonymous:${anonymousIdentity!.anonymousDraftId}`,
        expiresAt: new Date(dependencies.clock().getTime() + 24 * 60 * 60 * 1000),
        key: input.idempotencyKey,
        requestFingerprint: JSON.stringify([manifest.id, manifest.version]),
        scope: "gift-create",
      });
      if (persisted.status === "conflict") {
        return failure({ code: "IDEMPOTENCY_CONFLICT" });
      }

      return success({ anonymousIdentity, gift: toDto(persisted.gift) });
    },

    async getDraft(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        publicId: string;
      }>,
    ): Promise<GiftServiceResult<GiftDraftDto>> {
      const gift = await dependencies.gifts.findAuthorized(input.publicId, input.accessors);
      return gift?.status === "draft" ? success(toDto(gift)) : failure({ code: "NOT_FOUND" });
    },

    /**
     * The Studio page's read: a draft opens the editor, a published gift the published panel.
     * Every other status, and no access, is the same opaque not-found.
     */
    async getStudioGift(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        publicId: string;
      }>,
    ): Promise<GiftServiceResult<StudioGiftView>> {
      if (input.accessors.length === 0) return failure({ code: "NOT_FOUND" });
      const gift = await dependencies.gifts.findAuthorized(input.publicId, input.accessors);
      if (gift?.status === "draft") {
        // Only after the owner filter: a page receives a gift reference only for its own gift.
        const analytics =
          dependencies.analytics?.contextForGift({
            id: gift.id,
            templateId: gift.content.templateId,
            templateVersion: gift.content.templateVersion,
          }) ?? null;
        return success({ analytics, draft: toDto(gift), kind: "draft" });
      }
      if (gift?.status === "published" && gift.shareId && gift.publishedAt) {
        return success({
          kind: "published",
          publication: toPublicationDto(gift.publicId, {
            publishedAt: gift.publishedAt,
            revision: gift.revision,
            shareId: gift.shareId,
          }),
        });
      }
      return failure({ code: "NOT_FOUND" });
    },

    /**
     * Publishes the stored content of the expected revision for its signed-in owner. The checks run
     * in the order of `gift-publishing`; one transaction writes the gift, the asset confirmations,
     * the immutable publication and the idempotency key.
     */
    async publishGift(
      input: Readonly<{
        expectedRevision: number;
        idempotencyKey: string;
        publicId: string;
        /** Correlates a failed after-response analytics write in the log; nothing else. */
        requestId?: string;
        userId: string | null;
      }>,
    ): Promise<GiftServiceResult<GiftPublicationDto>> {
      const publishing = dependencies.publishing;
      if (!publishing) throw new Error("Gift publishing is not configured.");
      if (!input.userId) return failure({ code: "NOT_AUTHENTICATED" });

      // The owner only: the anonymous cookie and preview tokens never authorize publishing.
      const ownerAccessors: readonly GiftAccessor[] = [{ kind: "user", userId: input.userId }];
      const gift = await dependencies.gifts.findAuthorized(input.publicId, ownerAccessors);
      if (!gift) return failure({ code: "NOT_FOUND" });
      // Only after ownership is proven, so the flag never reveals that a gift exists.
      if (!publishing.entitlement.canPublish(input.userId)) return failure({ code: "FORBIDDEN" });

      const idempotency: GiftPublishIdempotency = {
        actorKey: `user:${input.userId}`,
        expiresAt: new Date(dependencies.clock().getTime() + PUBLISH_IDEMPOTENCY_TTL_MILLISECONDS),
        key: input.idempotencyKey,
        requestFingerprint: JSON.stringify(["publish", input.publicId, input.expectedRevision]),
        scope: "gift-publish",
      };
      // Before the status check: a lost response of a successful publish is replayed as `201`.
      const replay = await dependencies.gifts.findPublishReplay(idempotency, gift.id);
      if (replay) {
        return replay.status === "replayed"
          ? success(toPublicationDto(gift.publicId, replay.publication))
          : failure({ code: "IDEMPOTENCY_CONFLICT" });
      }

      if (gift.status !== "draft") return failure({ code: "INVALID_STATE" });
      if (gift.revision !== input.expectedRevision) {
        return failure({
          actualRevision: gift.revision,
          code: "REVISION_CONFLICT",
          expectedRevision: input.expectedRevision,
        });
      }
      if (gift.access.mode !== "unlisted") return failure({ code: "ACCESS_POLICY_UNSUPPORTED" });

      const manifest = await dependencies.templates.findEditableManifest(
        gift.content.templateId,
        gift.content.templateVersion,
      );
      if (!manifest) return failure({ code: "TEMPLATE_NOT_EDITABLE" });
      const artifact = publishing.artifacts.resolve(manifest.id, manifest.version);
      if (!artifact) return failure({ code: "TEMPLATE_UNPUBLISHABLE" });

      const content = gift.content.data;
      const contentIssuesFor = (assets: readonly MediaAsset[]) =>
        collectContentIssues(
          { assets, content, giftId: gift.id, manifest },
          dependencies.audioTracks,
        );
      const checkedAssets = await publishing.assets.listByGiftId(gift.id);
      const issues = contentIssuesFor(checkedAssets);
      if (issues.length > 0) {
        return failure({
          code: "INVALID_CONTENT",
          fieldErrors: issuesToFieldErrors(issues, toViewerFields(manifest)),
        });
      }

      const published = publishGiftDraft(gift, {
        expectedRevision: input.expectedRevision,
        now: dependencies.clock(),
        shareId: publishing.createShareId(),
      });
      if (!published.ok) {
        // The checks above already cover these; the domain refuses them again.
        return published.error.code === "GIFT_NOT_OWNED"
          ? failure({ code: "NOT_FOUND" })
          : failure({ code: "INVALID_STATE" });
      }

      const assetRefs = listImageFieldReferences(manifest, content);
      const audioField = manifest.fields.find((field) => field.type === "audio");
      const audioValue = audioField ? content[audioField.id] : undefined;
      const publication = createGiftPublication({
        artifactContentHash: artifact.contentHash,
        assetIds: uniqueAssetIds(assetRefs),
        audioTrackId: typeof audioValue === "string" ? audioValue : null,
        gift: published.data,
        id: dependencies.createId(),
      });

      const outcome = await dependencies.gifts.publishDraft({
        assetRefs,
        expectedRevision: input.expectedRevision,
        gift: published.data,
        idempotency,
        ownerId: input.userId,
        publication,
      });
      switch (outcome.status) {
        case "published":
          // A first publish only: replays and every rejection record nothing.
          try {
            dependencies.analytics?.publish.giftPublished({
              giftId: gift.id,
              requestId: input.requestId ?? "unknown",
              templateId: outcome.publication.templateId,
              templateVersion: outcome.publication.templateVersion,
            });
          } catch {
            // Best effort: analytics never changes the publish response.
          }
          return success(toPublicationDto(gift.publicId, outcome.publication));
        case "replayed":
          return success(toPublicationDto(gift.publicId, outcome.publication));
        case "idempotency-conflict":
          return failure({ code: "IDEMPOTENCY_CONFLICT" });
        case "assets-changed": {
          const freshAssets = await publishing.assets.listByGiftId(gift.id);
          const fresh = contentIssuesFor(freshAssets);
          const fieldErrors =
            fresh.length > 0
              ? issuesToFieldErrors(fresh, toViewerFields(manifest))
              : changedImageFieldErrors(assetRefs, checkedAssets, freshAssets);
          return failure({ code: "INVALID_CONTENT", fieldErrors });
        }
        case "stale": {
          const current = await dependencies.gifts.findAuthorized(input.publicId, ownerAccessors);
          if (!current) return failure({ code: "NOT_FOUND" });
          if (current.status !== "draft") return failure({ code: "INVALID_STATE" });
          if (current.access.mode !== "unlisted") {
            return failure({ code: "ACCESS_POLICY_UNSUPPORTED" });
          }
          return failure({
            actualRevision: current.revision,
            code: "REVISION_CONFLICT",
            expectedRevision: input.expectedRevision,
          });
        }
      }
    },

    async updateDraft(
      input: Readonly<{
        accessors: readonly GiftAccessor[];
        content: Readonly<Record<string, unknown>>;
        expectedRevision: number;
        publicId: string;
      }>,
    ): Promise<GiftServiceResult<GiftDraftDto>> {
      const gift = await dependencies.gifts.findAuthorized(input.publicId, input.accessors);
      // A gift that left `draft` (for example a published one) is no longer a draft to save.
      if (gift?.status !== "draft") {
        return failure({ code: "NOT_FOUND" });
      }

      const manifest = await dependencies.templates.findEditableManifest(
        gift.content.templateId,
        gift.content.templateVersion,
      );
      if (!manifest) {
        return failure({ code: "INVALID_STATE" });
      }

      let content: Readonly<Record<string, unknown>>;
      try {
        content = parseTemplateDraftPayload(manifest, input.content);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return failure({ code: "INVALID_CONTENT", fieldErrors: toFieldErrors(error) });
        }
        throw error;
      }

      const unavailableAudio = manifest.fields.filter(
        (field) =>
          field.type === "audio" &&
          typeof content[field.id] === "string" &&
          !dependencies.audioTracks.isSelectableTrack(content[field.id] as string),
      );
      if (unavailableAudio.length > 0) {
        return failure({
          code: "INVALID_CONTENT",
          fieldErrors: Object.fromEntries(
            unavailableAudio.map((field) => [field.id, "Audio track is not available."]),
          ),
        });
      }

      const mediaReferences: GiftMediaReferenceGroup[] = listImageFieldReferences(
        manifest,
        content,
      );
      if (!(await dependencies.gifts.validateMediaReferences(gift.id, mediaReferences))) {
        return failure({
          code: "INVALID_CONTENT",
          fieldErrors: Object.fromEntries(
            mediaReferences.map(({ fieldId }) => [
              fieldId,
              "Image assets must exist and belong to this gift field.",
            ]),
          ),
        });
      }
      const updated = updateGiftDraft(gift, {
        content: { ...gift.content, data: content },
        expectedRevision: input.expectedRevision,
        now: dependencies.clock(),
      });

      if (!updated.ok) {
        if (updated.error.code === "GIFT_REVISION_CONFLICT") {
          return failure({
            actualRevision: updated.error.actualRevision,
            code: "REVISION_CONFLICT",
            expectedRevision: updated.error.expectedRevision,
          });
        }
        return failure({ code: "INVALID_STATE" });
      }

      const persisted = await dependencies.gifts.updateDraft(
        updated.data,
        input.expectedRevision,
        input.accessors,
      );
      if (persisted) {
        return success(toDto(persisted));
      }

      const current = await dependencies.gifts.findAuthorized(input.publicId, input.accessors);
      if (current?.status !== "draft") {
        return failure({ code: "NOT_FOUND" });
      }
      return failure({
        actualRevision: current.revision,
        code: "REVISION_CONFLICT",
        expectedRevision: input.expectedRevision,
      });
    },
  } as const;
}
