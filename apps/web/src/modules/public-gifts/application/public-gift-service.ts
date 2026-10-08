import { type Gift, type GiftPublication, ShareIdSchema } from "@love-memory/domain";
import { type AnalyticsContext } from "@love-memory/contracts";
import { type TemplateManifest } from "@love-memory/template-sdk";

import {
  type AnalyticsContextFactory,
  type GiftPublicationRepository,
  type GiftRepository,
  type GiftTemplateRepository,
} from "@/modules/gifts/application/gift-service";
import {
  buildViewerPayload,
  type BuildViewerPayloadDependencies,
} from "@/modules/viewer/application/build-viewer-payload";
import { type MediaAssetRepository } from "@/modules/media/application/media-service";
import { type ViewerPayload } from "@/modules/viewer/application/viewer-payload";

/** What a recipient receives: the shared viewer payload without the creator-only issues. */
export type PublicViewerPayload = Omit<ViewerPayload, "issues">;

/**
 * What `/g/{shareId}` needs to render its envelope: no content, only the analytics context and
 * whether the gift's entitlement carries the host-level watermark.
 */
export type PublicGiftPage = Readonly<{ analytics: AnalyticsContext | null; watermark: boolean }>;

export type PublicGiftServiceDependencies = Readonly<{
  /** The page analytics context after the liveness check; absent or `null` while disabled. */
  analytics?: Readonly<{ contextForGift: AnalyticsContextFactory }>;
  /** The publication snapshot's assets only, filtered by the gift id. */
  assets: Pick<MediaAssetRepository, "listByIdsForGift">;
  /** Server time, read once per request: it alone decides expiry (`gift-plans`). */
  clock: () => Date;
  gifts: Pick<GiftRepository, "findPublishedByShareId">;
  payload: BuildViewerPayloadDependencies;
  publications: Pick<GiftPublicationRepository, "findByGiftRevision">;
  templates: Pick<GiftTemplateRepository, "findEditableManifest">;
}>;

type LiveShare = Readonly<{
  gift: Gift;
  manifest: TemplateManifest;
  publication: GiftPublication;
}>;

export function createPublicGiftService(dependencies: PublicGiftServiceDependencies) {
  /**
   * The one liveness check of a share link, shared by the page and the payload endpoint so they
   * never disagree. Every cause of not-found gives the same `null`.
   */
  async function resolveLiveShare(shareId: string): Promise<LiveShare | null> {
    // A malformed share id never reaches the database.
    if (!ShareIdSchema.safeParse(shareId).success) return null;

    const now = dependencies.clock();
    const gift = await dependencies.gifts.findPublishedByShareId(shareId, now);
    // The query already filters these; the check repeats them so a looser query fails closed.
    if (
      gift?.status !== "published" ||
      gift.access.mode !== "unlisted" ||
      gift.shareId !== shareId ||
      gift.expiresAt === undefined ||
      gift.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }

    // The current publication only: superseded ones and the working copy are never served.
    if (gift.publishedRevision === undefined) return null;
    const publication = await dependencies.publications.findByGiftRevision(
      gift.id,
      gift.publishedRevision,
    );
    if (publication?.giftId !== gift.id || publication.shareId !== shareId) return null;

    const manifest = await dependencies.templates.findEditableManifest(
      publication.templateId,
      publication.templateVersion,
    );
    return manifest ? { gift, manifest, publication } : null;
  }

  return {
    /**
     * Whether `/g/{shareId}` renders the envelope (`null` for every not-found cause), with the
     * analytics context of the published snapshot. It loads no content and signs nothing.
     */
    async resolvePublicGiftPage(shareId: string): Promise<PublicGiftPage | null> {
      const live = await resolveLiveShare(shareId);
      if (!live) return null;
      const analytics =
        dependencies.analytics?.contextForGift({
          id: live.gift.id,
          templateId: live.publication.templateId,
          templateVersion: live.publication.templateVersion,
        }) ?? null;
      return { analytics, watermark: live.gift.entitlement?.watermark ?? true };
    },

    /**
     * The viewer payload of the publication snapshot, pinned to the artifact bytes it was
     * published with: a changed artifact gives `artifactUrl: null` (the static rendering).
     */
    async openPublicGift(shareId: string): Promise<PublicViewerPayload | null> {
      const live = await resolveLiveShare(shareId);
      if (!live) return null;

      // Exactly the snapshot's assets: the immutable truth of a published gift, read by `_id`.
      const assets = await dependencies.assets.listByIdsForGift(
        live.gift.id,
        live.publication.assetIds,
      );
      const viewer = await buildViewerPayload(
        {
          assets,
          content: live.publication.content,
          expectedContentHash: live.publication.artifactContentHash,
          giftId: live.gift.id,
          manifest: live.manifest,
        },
        dependencies.payload,
      );
      const { issues: _creatorIssues, ...recipientViewer } = viewer;
      return recipientViewer;
    },
  } as const;
}

export type PublicGiftService = ReturnType<typeof createPublicGiftService>;
