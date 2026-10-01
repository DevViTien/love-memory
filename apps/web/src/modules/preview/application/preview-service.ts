import { type MediaAsset } from "@love-memory/domain";

import {
  type GiftAccessor,
  type GiftRepository,
  type GiftServiceResult,
  type GiftTemplateRepository,
} from "@/modules/gifts/application/gift-service";
import {
  buildViewerPayload,
  type BuildViewerPayloadDependencies,
} from "@/modules/viewer/application/build-viewer-payload";
import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";

import {
  generatePreviewToken,
  hashPreviewToken,
  isPreviewTokenFormat,
  PREVIEW_TOKEN_TTL_SECONDS,
} from "./preview-token";

/** The stored form of a preview token: never the token itself. */
export type PreviewTokenRecord = Readonly<{
  createdAt: Date;
  expiresAt: Date;
  giftId: string;
  tokenHash: string;
}>;

export interface PreviewTokenRepository {
  /** A token whose `expiresAt` is later than `now`, whatever the TTL monitor has deleted. */
  findActive(
    tokenHash: string,
    now: Date,
  ): Promise<Readonly<{ expiresAt: Date; giftId: string }> | null>;
  insert(record: PreviewTokenRecord): Promise<void>;
}

export type PreviewLink = Readonly<{ expiresAt: string; url: string }>;

export type OpenedPreview = Readonly<{
  publicId: string;
  viewer: ViewerPayload;
}>;

export type PreviewServiceDependencies = Readonly<{
  assets: Readonly<{ listByGiftId: (giftId: string) => Promise<readonly MediaAsset[]> }>;
  clock: () => Date;
  generateToken?: () => string;
  gifts: Pick<GiftRepository, "findAuthorized" | "findDraftById">;
  payload: BuildViewerPayloadDependencies;
  templates: Pick<GiftTemplateRepository, "findEditableManifest">;
  tokens: PreviewTokenRepository;
}>;

export function createPreviewService(dependencies: PreviewServiceDependencies) {
  const generateToken = dependencies.generateToken ?? generatePreviewToken;

  return {
    /** Whether these credentials may edit the draft, the Studio's own rule. It grants nothing. */
    async canEditDraft(
      input: Readonly<{ accessors: readonly GiftAccessor[]; publicId: string }>,
    ): Promise<boolean> {
      if (input.accessors.length === 0) return false;
      const gift = await dependencies.gifts.findAuthorized(input.publicId, input.accessors);
      return gift?.status === "draft";
    },

    /**
     * Issues a new 30-minute preview link for an authorized draft. The token exists only in the
     * returned URL; only its hash is stored.
     */
    async createPreviewLink(
      input: Readonly<{ accessors: readonly GiftAccessor[]; publicId: string }>,
    ): Promise<GiftServiceResult<PreviewLink>> {
      const gift = await dependencies.gifts.findAuthorized(input.publicId, input.accessors);
      if (gift?.status !== "draft") {
        return { error: { code: "NOT_FOUND" }, ok: false };
      }

      const manifest = await dependencies.templates.findEditableManifest(
        gift.content.templateId,
        gift.content.templateVersion,
      );
      if (!manifest) {
        return { error: { code: "INVALID_STATE" }, ok: false };
      }

      const token = generateToken();
      const createdAt = dependencies.clock();
      const expiresAt = new Date(createdAt.getTime() + PREVIEW_TOKEN_TTL_SECONDS * 1000);
      await dependencies.tokens.insert({
        createdAt,
        expiresAt,
        giftId: gift.id,
        tokenHash: hashPreviewToken(token),
      });

      return { data: { expiresAt: expiresAt.toISOString(), url: `/preview/${token}` }, ok: true };
    },

    /**
     * Renders the current draft behind a valid, unexpired token. Every failure gives the same
     * `null`, so the page answers with one opaque not-found page.
     */
    async openPreview(token: string): Promise<OpenedPreview | null> {
      if (!isPreviewTokenFormat(token)) return null;

      const record = await dependencies.tokens.findActive(
        hashPreviewToken(token),
        dependencies.clock(),
      );
      if (!record) return null;

      const gift = await dependencies.gifts.findDraftById(record.giftId);
      if (!gift) return null;

      const manifest = await dependencies.templates.findEditableManifest(
        gift.content.templateId,
        gift.content.templateVersion,
      );
      if (!manifest) return null;

      const assets = await dependencies.assets.listByGiftId(gift.id);
      const viewer = await buildViewerPayload(
        { assets, content: gift.content.data, giftId: gift.id, manifest },
        dependencies.payload,
      );

      return { publicId: gift.publicId, viewer };
    },
  } as const;
}

export type PreviewService = ReturnType<typeof createPreviewService>;
