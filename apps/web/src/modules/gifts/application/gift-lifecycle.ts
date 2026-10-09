import { canTransitionGift, type Gift } from "@love-memory/domain";

import { type GiftAccessor } from "./gift-service";

export const GIFT_DELETE_JOB = "gift.delete.v1" as const;

/** The purge promise of `gift-lifecycle`: content is gone within 24 hours of the request. */
export const GIFT_PURGE_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1000;

export function giftDeleteJobKey(giftId: string): string {
  return `${GIFT_DELETE_JOB}:${giftId}`;
}

/** Conditional status writes; each answers whether it changed the gift (`false` on a lost race). */
export interface GiftLifecycleRepository {
  findAuthorized(publicId: string, accessors: readonly GiftAccessor[]): Promise<Gift | null>;
  /** `published` → `paused`. */
  pause(giftId: string, now: Date): Promise<boolean>;
  /** `draft`, `published` or `paused` → `deleting`, with `gift.delete.v1` in the same transaction. */
  requestDeletion(giftId: string, now: Date): Promise<boolean>;
  /** `paused` → `published`, only while `expiresAt` is later than `now`. */
  resume(giftId: string, now: Date): Promise<boolean>;
}

export type GiftLifecycleError = Readonly<
  | { code: "GIFT_EXPIRED" }
  | { code: "GIFT_NOT_PUBLISHED" }
  | { code: "GIFT_TAKEN_DOWN" }
  | { code: "NOT_FOUND" }
>;

export type GiftLifecycleResult<T> =
  Readonly<{ data: T; ok: true }> | Readonly<{ error: GiftLifecycleError; ok: false }>;

export type GiftStatusView = Readonly<{ publicId: string; status: "paused" | "published" }>;

export type GiftDeletionView = Readonly<{
  purgeBy: string;
  requestedAt: string;
  status: "deleting";
}>;

/** What the Studio shows for a paused gift: no content, only what the panel needs. */
export type PausedGiftView = Readonly<{
  expired: boolean;
  expiresAt: string;
  publicId: string;
  /** Held paused by the operations team (`abuse-reports` "Takedown"): no resume. */
  takenDown: boolean;
}>;

type Dependencies = Readonly<{
  clock?: () => Date;
  gifts: GiftLifecycleRepository;
  /** Wakes a worker after a commit that enqueued the deletion job; never throws. */
  jobs?: Readonly<{ dispatch: (type: typeof GIFT_DELETE_JOB) => Promise<void> }>;
}>;

function userAccessors(accessors: readonly GiftAccessor[]): readonly GiftAccessor[] {
  return accessors.filter((accessor) => accessor.kind === "user");
}

function fail(code: GiftLifecycleError["code"]): GiftLifecycleResult<never> {
  return { error: { code }, ok: false };
}

function deletionView(requestedAt: Date): GiftDeletionView {
  return {
    purgeBy: new Date(requestedAt.getTime() + GIFT_PURGE_WINDOW_MILLISECONDS).toISOString(),
    requestedAt: requestedAt.toISOString(),
    status: "deleting",
  };
}

/**
 * Owner pause, resume and delete (`gift-lifecycle`). Every write is conditional on the stored
 * status, so each request is idempotent by state; a lost race re-reads and answers from the result.
 */
export function createGiftLifecycleService({
  clock = () => new Date(),
  gifts,
  jobs,
}: Dependencies) {
  /** Only the signed-in owner pauses, resumes or deletes a gift that has been published. */
  async function findOwned(publicId: string, accessors: readonly GiftAccessor[]) {
    const owners = userAccessors(accessors);
    return owners.length === 0 ? null : gifts.findAuthorized(publicId, owners);
  }

  async function pause(
    publicId: string,
    accessors: readonly GiftAccessor[],
  ): Promise<GiftLifecycleResult<GiftStatusView>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const gift = await findOwned(publicId, accessors);
      if (!gift) return fail("NOT_FOUND");
      if (gift.status === "paused") return { data: { publicId, status: "paused" }, ok: true };
      if (gift.status === "draft") return fail("GIFT_NOT_PUBLISHED");
      if (gift.status !== "published" || !canTransitionGift("published", "paused")) {
        return fail("NOT_FOUND");
      }
      if (await gifts.pause(gift.id, clock())) {
        return { data: { publicId, status: "paused" }, ok: true };
      }
    }
    return fail("NOT_FOUND");
  }

  async function resume(
    publicId: string,
    accessors: readonly GiftAccessor[],
  ): Promise<GiftLifecycleResult<GiftStatusView>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const gift = await findOwned(publicId, accessors);
      if (!gift) return fail("NOT_FOUND");
      if (gift.status === "published") return { data: { publicId, status: "published" }, ok: true };
      if (gift.status === "draft") return fail("GIFT_NOT_PUBLISHED");
      if (gift.status !== "paused" || !canTransitionGift("paused", "published")) {
        return fail("NOT_FOUND");
      }
      if (gift.takedown) return fail("GIFT_TAKEN_DOWN");
      const now = clock();
      if (!gift.expiresAt || gift.expiresAt.getTime() <= now.getTime()) return fail("GIFT_EXPIRED");
      if (await gifts.resume(gift.id, now)) {
        return { data: { publicId, status: "published" }, ok: true };
      }
    }
    return fail("NOT_FOUND");
  }

  async function deleteGift(
    publicId: string,
    accessors: readonly GiftAccessor[],
  ): Promise<GiftLifecycleResult<GiftDeletionView>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const gift = accessors.length === 0 ? null : await gifts.findAuthorized(publicId, accessors);
      if (!gift) return fail("NOT_FOUND");
      // A gift that has been published belongs to a signed-in owner: a draft cookie never deletes it.
      const ownerMatches =
        gift.status === "draft" ||
        userAccessors(accessors).some(
          (accessor) => accessor.kind === "user" && accessor.userId === gift.ownership.ownerId,
        );
      if (!ownerMatches) return fail("NOT_FOUND");
      if (gift.status === "deleting") {
        return gift.deletionRequestedAt
          ? { data: deletionView(gift.deletionRequestedAt), ok: true }
          : fail("NOT_FOUND");
      }
      if (!canTransitionGift(gift.status, "deleting")) return fail("NOT_FOUND");
      const now = clock();
      if (await gifts.requestDeletion(gift.id, now)) {
        await jobs?.dispatch(GIFT_DELETE_JOB);
        return { data: deletionView(now), ok: true };
      }
    }
    return fail("NOT_FOUND");
  }

  /** The Studio's view of a paused gift for its signed-in owner, or `null`. */
  async function findPaused(
    publicId: string,
    accessors: readonly GiftAccessor[],
  ): Promise<PausedGiftView | null> {
    const gift = await findOwned(publicId, accessors);
    if (gift?.status !== "paused" || !gift.expiresAt) return null;
    return {
      expired: gift.expiresAt.getTime() <= clock().getTime(),
      expiresAt: gift.expiresAt.toISOString(),
      publicId,
      takenDown: gift.takedown !== undefined,
    };
  }

  return { deleteGift, findPaused, pause, resume } as const;
}

export type GiftLifecycleService = ReturnType<typeof createGiftLifecycleService>;
