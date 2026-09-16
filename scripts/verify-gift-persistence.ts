import { createHash, randomBytes, randomUUID } from "node:crypto";

import { COLLECTIONS, getDatabase, getMongoClient } from "../packages/database/src/index";
import { createGiftDraft, updateGiftDraft } from "../packages/domain/src/index";
import { mongoGiftRepository } from "../apps/web/src/modules/gifts/infrastructure/mongo-gift-repository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const giftId = randomUUID();
const anonymousDraftId = randomUUID();
const publicId = `verify_${randomBytes(12).toString("base64url")}`;
const claimTokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
const anonymousAccessor = {
  anonymousDraftId,
  claimTokenHash,
  kind: "anonymous" as const,
};

const draft = createGiftDraft({
  anonymousDraftId,
  claimTokenHash,
  content: {
    data: {},
    schemaVersion: 1,
    templateId: "memory-box",
    templateVersion: "1.0.0",
  },
  id: giftId,
  now: new Date(),
  ownerId: null,
  publicId,
});
const idempotency = {
  accessor: anonymousAccessor,
  actorKey: `anonymous:${anonymousDraftId}`,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  key: randomUUID(),
  requestFingerprint: JSON.stringify([draft.content.templateId, draft.content.templateVersion]),
  scope: "gift-create" as const,
};

const database = await getDatabase();

try {
  await mongoGiftRepository.createDraft(draft, idempotency);

  const authorized = await mongoGiftRepository.findAuthorized(publicId, [anonymousAccessor]);
  assert(authorized?.id === giftId, "Anonymous authorization did not return the created draft.");

  const denied = await mongoGiftRepository.findAuthorized(publicId, [
    {
      isAdmin: false,
      kind: "user",
      userId: "different-owner",
    },
  ]);
  assert(denied === null, "Owner isolation failed.");

  const next = updateGiftDraft(draft, {
    content: { ...draft.content, data: { headline: "Persistence verification" } },
    expectedRevision: 0,
    now: new Date(),
  });
  assert(next.ok, "Domain update failed.");

  const persisted = await mongoGiftRepository.updateDraft(next.data, 0, [anonymousAccessor]);
  assert(persisted?.revision === 1, "Optimistic update did not persist revision 1.");

  const stale = await mongoGiftRepository.updateDraft(next.data, 0, [anonymousAccessor]);
  assert(stale === null, "A stale revision unexpectedly overwrote current content.");

  const claimed = await mongoGiftRepository.claimDraft(
    publicId,
    "verification-user",
    anonymousDraftId,
    claimTokenHash,
    new Date(),
  );
  assert(claimed?.ownership.ownerId === "verification-user", "Draft claim failed.");

  const revokedReplay = await mongoGiftRepository.createDraft(draft, idempotency);
  assert(
    revokedReplay.status === "conflict",
    "Anonymous idempotency replay remained valid after claim.",
  );

  process.stdout.write("Gift persistence verification completed successfully.\n");
} finally {
  await Promise.all([
    database.collection<{ _id: string }>(COLLECTIONS.gifts).deleteOne({ _id: giftId }),
    database
      .collection<{ _id: string; giftId: string }>(COLLECTIONS.giftRevisions)
      .deleteMany({ giftId }),
    database.collection<{ giftId: string }>(COLLECTIONS.idempotencyKeys).deleteMany({ giftId }),
  ]);
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
