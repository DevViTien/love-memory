import { type AdminSession } from "./admin-access";
import { type AuditService } from "./audit";

/** No gift identifier is longer; anything longer matches nothing and is not queried. */
export const GIFT_LOOKUP_MAX_LENGTH = 64;

export type AdminGiftOwner =
  Readonly<{ email: string | null; id: string; kind: "user" }> | Readonly<{ kind: "anonymous" }>;

/**
 * Everything an admin may see of a gift (`admin-access` "Admin gift lookup"): identifiers, state,
 * plan, times, owner and asset counts. No content, captions, asset ids, storage keys or share link.
 */
export type AdminGiftSummary = Readonly<{
  assetCounts: Readonly<Record<string, number>>;
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  owner: AdminGiftOwner;
  planId: string | null;
  publicId: string;
  publishedAt: Date | null;
  publishedRevision: number | null;
  revision: number;
  status: string;
  templateId: string;
  templateVersion: string;
  updatedAt: Date;
}>;

export interface AdminGiftLookupRepository {
  /** An exact match on the internal id, `publicId` or `shareId`; never on content. */
  findSummary(query: string): Promise<AdminGiftSummary | null>;
}

export type GiftLookupResult =
  | Readonly<{ gift: AdminGiftSummary; kind: "found" }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "not-found" }>;

/**
 * Every search is audited before anything is returned, so a failed audit write fails the page
 * instead of showing unaudited data. The searched text is never recorded: it can be a share id.
 */
export function createGiftLookupService({
  audit,
  repository,
}: Readonly<{ audit: Pick<AuditService, "record">; repository: AdminGiftLookupRepository }>) {
  async function lookup(
    input: Readonly<{ query: string; requestId: string | null; session: AdminSession }>,
  ): Promise<GiftLookupResult> {
    const query = input.query.trim();
    if (!query) return { kind: "empty" };

    const gift =
      query.length <= GIFT_LOOKUP_MAX_LENGTH ? await repository.findSummary(query) : null;
    await audit.record(
      {
        action: "admin.gift.looked_up",
        actor: { id: input.session.user.id, kind: "admin" },
        metadata: { matched: gift !== null },
        target: gift ? { id: gift.id, kind: "gift" } : null,
      },
      input.requestId,
    );
    return gift ? { gift, kind: "found" } : { kind: "not-found" };
  }

  return { lookup } as const;
}

export type GiftLookupService = ReturnType<typeof createGiftLookupService>;
