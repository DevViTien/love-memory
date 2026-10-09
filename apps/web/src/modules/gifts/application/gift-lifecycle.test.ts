import { type Gift } from "@love-memory/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGiftLifecycleService, type GiftLifecycleRepository } from "./gift-lifecycle";
import { type GiftAccessor } from "./gift-service";

const now = new Date("2026-10-10T10:00:00.000Z");
const owner: GiftAccessor = { kind: "user", userId: "user-1" };
const anonymous: GiftAccessor = {
  anonymousDraftId: "11111111-1111-4111-8111-111111111111",
  claimTokenHash: "a".repeat(64),
  kind: "anonymous",
};

function gift(overrides: Partial<Gift> = {}): Gift {
  return {
    access: { mode: "unlisted" },
    content: { data: {}, schemaVersion: 1, templateId: "memory-box", templateVersion: "1.1.0" },
    createdAt: now,
    entitlement: undefined,
    id: "7afd9fe9-d30d-41cc-8f9a-0fe907f7df89",
    ownership: { anonymousDraftId: null, claimTokenHash: null, ownerId: "user-1" },
    publicId: "pub-1",
    revision: 1,
    status: "published",
    updatedAt: now,
    expiresAt: new Date("2026-10-24T10:00:00.000Z"),
    ...overrides,
  };
}

describe("gift lifecycle", () => {
  const findAuthorized = vi.fn<GiftLifecycleRepository["findAuthorized"]>();
  const pause = vi.fn<GiftLifecycleRepository["pause"]>();
  const resume = vi.fn<GiftLifecycleRepository["resume"]>();
  const requestDeletion = vi.fn<GiftLifecycleRepository["requestDeletion"]>();
  const dispatch = vi.fn(() => Promise.resolve());
  const service = createGiftLifecycleService({
    clock: () => now,
    gifts: { findAuthorized, pause, requestDeletion, resume },
    jobs: { dispatch },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pause", () => {
    it("pauses a published gift of the signed-in owner (Owner pauses a published gift)", async () => {
      findAuthorized.mockResolvedValueOnce(gift());
      pause.mockResolvedValueOnce(true);

      await expect(service.pause("pub-1", [owner, anonymous])).resolves.toEqual({
        data: { publicId: "pub-1", status: "paused" },
        ok: true,
      });
      expect(findAuthorized).toHaveBeenCalledWith("pub-1", [owner]);
      expect(pause).toHaveBeenCalledWith(gift().id, now);
    });

    it("answers a paused gift unchanged and refuses a draft", async () => {
      findAuthorized.mockResolvedValueOnce(gift({ status: "paused" }));
      await expect(service.pause("pub-1", [owner])).resolves.toMatchObject({ ok: true });
      expect(pause).not.toHaveBeenCalled();

      findAuthorized.mockResolvedValueOnce(gift({ status: "draft" }));
      await expect(service.pause("pub-1", [owner])).resolves.toEqual({
        error: { code: "GIFT_NOT_PUBLISHED" },
        ok: false,
      });
    });

    it("answers not-found without a signed-in owner or for a deleting gift (Someone else pauses)", async () => {
      await expect(service.pause("pub-1", [anonymous])).resolves.toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
      expect(findAuthorized).not.toHaveBeenCalled();

      findAuthorized.mockResolvedValueOnce(gift({ status: "deleting" }));
      await expect(service.pause("pub-1", [owner])).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
    });

    it("re-reads after a lost race and answers from the new state", async () => {
      findAuthorized
        .mockResolvedValueOnce(gift())
        .mockResolvedValueOnce(gift({ status: "paused" }));
      pause.mockResolvedValueOnce(false);

      await expect(service.pause("pub-1", [owner])).resolves.toMatchObject({
        data: { status: "paused" },
      });
    });
  });

  describe("resume", () => {
    it("resumes a paused gift before its expiry (Owner resumes the gift)", async () => {
      findAuthorized.mockResolvedValueOnce(gift({ status: "paused" }));
      resume.mockResolvedValueOnce(true);

      await expect(service.resume("pub-1", [owner])).resolves.toEqual({
        data: { publicId: "pub-1", status: "published" },
        ok: true,
      });
    });

    it("refuses an expired gift (Expired gift cannot be resumed)", async () => {
      findAuthorized.mockResolvedValueOnce(gift({ expiresAt: now, status: "paused" }));

      await expect(service.resume("pub-1", [owner])).resolves.toEqual({
        error: { code: "GIFT_EXPIRED" },
        ok: false,
      });
      expect(resume).not.toHaveBeenCalled();
    });

    it("refuses a taken-down gift (Taken-down gift cannot be resumed)", async () => {
      findAuthorized.mockResolvedValueOnce(
        gift({ status: "paused", takedown: { at: now, by: "admin", reason: "harassment" } }),
      );

      await expect(service.resume("pub-1", [owner])).resolves.toEqual({
        error: { code: "GIFT_TAKEN_DOWN" },
        ok: false,
      });
      expect(resume).not.toHaveBeenCalled();
    });

    it("answers a published gift unchanged and refuses a draft", async () => {
      findAuthorized.mockResolvedValueOnce(gift());
      await expect(service.resume("pub-1", [owner])).resolves.toMatchObject({ ok: true });
      findAuthorized.mockResolvedValueOnce(gift({ status: "draft" }));
      await expect(service.resume("pub-1", [owner])).resolves.toMatchObject({
        error: { code: "GIFT_NOT_PUBLISHED" },
      });
      expect(resume).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("moves a published gift to deleting and wakes the worker (Owner deletes a published gift)", async () => {
      findAuthorized.mockResolvedValueOnce(gift());
      requestDeletion.mockResolvedValueOnce(true);

      await expect(service.deleteGift("pub-1", [owner])).resolves.toEqual({
        data: {
          purgeBy: "2026-10-11T10:00:00.000Z",
          requestedAt: now.toISOString(),
          status: "deleting",
        },
        ok: true,
      });
      expect(dispatch).toHaveBeenCalledWith("gift.delete.v1");
    });

    it("lets the browser of an anonymous draft delete it, but never a published gift (Anonymous draft deleted from its browser)", async () => {
      const draft = gift({
        ownership: {
          anonymousDraftId: anonymous.kind === "anonymous" ? anonymous.anonymousDraftId : "",
          claimTokenHash: "a".repeat(64),
          ownerId: null,
        },
        status: "draft",
      });
      findAuthorized.mockResolvedValueOnce(draft);
      requestDeletion.mockResolvedValueOnce(true);
      await expect(service.deleteGift("pub-1", [anonymous])).resolves.toMatchObject({ ok: true });

      findAuthorized.mockResolvedValueOnce(gift());
      await expect(service.deleteGift("pub-1", [anonymous])).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
      expect(requestDeletion).toHaveBeenCalledTimes(1);
    });

    it("answers a repeated delete with the stored request time and enqueues nothing (Repeated delete)", async () => {
      const requestedAt = new Date("2026-10-10T09:00:00.000Z");
      findAuthorized.mockResolvedValueOnce(
        gift({ deletionRequestedAt: requestedAt, status: "deleting" }),
      );

      await expect(service.deleteGift("pub-1", [owner])).resolves.toMatchObject({
        data: { requestedAt: requestedAt.toISOString() },
      });
      expect(requestDeletion).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("answers not-found without access, and for another user's gift (Someone else deletes)", async () => {
      await expect(service.deleteGift("pub-1", [])).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
      findAuthorized.mockResolvedValueOnce(null);
      await expect(service.deleteGift("pub-1", [owner])).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
      findAuthorized.mockResolvedValueOnce(gift({ status: "deleted" }));
      await expect(service.deleteGift("pub-1", [owner])).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
    });
  });

  it("shows a paused gift to its owner only, with its expiry", async () => {
    findAuthorized.mockResolvedValueOnce(gift({ status: "paused" }));
    await expect(service.findPaused("pub-1", [owner])).resolves.toEqual({
      expired: false,
      expiresAt: "2026-10-24T10:00:00.000Z",
      publicId: "pub-1",
      takenDown: false,
    });

    findAuthorized.mockResolvedValueOnce(
      gift({ status: "paused", takedown: { at: now, by: "system", reason: "self_harm" } }),
    );
    await expect(service.findPaused("pub-1", [owner])).resolves.toMatchObject({ takenDown: true });

    findAuthorized.mockResolvedValueOnce(gift({ expiresAt: now, status: "paused" }));
    await expect(service.findPaused("pub-1", [owner])).resolves.toMatchObject({ expired: true });

    findAuthorized.mockResolvedValueOnce(gift());
    await expect(service.findPaused("pub-1", [owner])).resolves.toBeNull();
    await expect(service.findPaused("pub-1", [anonymous])).resolves.toBeNull();
  });
});
