// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/composition/media", () => ({ createStorage: () => ({ deleteObject: vi.fn() }) }));
vi.mock("@/modules/gifts/infrastructure/mongo-gift-repository", () => ({
  mongoGiftRepository: { findEditableById: vi.fn() },
}));
vi.mock("@/modules/gifts/infrastructure/mongo-gift-publication-repository", () => ({
  mongoGiftPublicationRepository: { findByGiftRevision: vi.fn() },
}));
vi.mock("@/modules/media/infrastructure/mongo-media-repository", () => ({
  mongoDetachedAssetRepository: {},
}));
const outbox = vi.hoisted(() => ({ hasOverdueJob: vi.fn(() => Promise.resolve(false)) }));
vi.mock("@/modules/jobs/infrastructure/mongo-job-outbox", () => ({ mongoJobOutbox: outbox }));

import { checkJobOutbox, createHandlers, REGISTERED_JOB_TYPES } from "./jobs";

describe("jobs composition", () => {
  it("registers exactly the handlers readiness watches, and never media processing", () => {
    const types = createHandlers().map((handler) => handler.type);

    expect(types).toEqual([...REGISTERED_JOB_TYPES]);
    expect(types).toEqual(["gift.assets.cleanup.v1"]);
    expect(types).not.toContain("media.process.v1");
  });

  it("checks the registered types for stalls without building a handler", async () => {
    await expect(checkJobOutbox()).resolves.toBeUndefined();
    expect(outbox.hasOverdueJob).toHaveBeenCalledWith(REGISTERED_JOB_TYPES, expect.any(Date));
  });
});
