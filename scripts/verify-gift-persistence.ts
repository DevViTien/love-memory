import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  COLLECTIONS,
  connectDiagnosticMongoClient,
  getDatabase,
  getMongoClient,
  parseMongoEnvironment,
} from "../packages/database/src/index";
import {
  createGiftDraft,
  createGiftPublication,
  currentPlan,
  type Gift,
  grantEntitlement,
  type MediaAsset,
  publishGiftDraft,
  republishGift,
  updateGiftDraft,
} from "../packages/domain/src/index";
import { type GiftPublishInput } from "../apps/web/src/modules/gifts/application/gift-service";
import { mongoGiftRepository } from "../apps/web/src/modules/gifts/infrastructure/mongo-gift-repository";
import { createJobRunner } from "../apps/web/src/modules/jobs/application/job-runner";
import { mongoJobOutbox } from "../apps/web/src/modules/jobs/infrastructure/mongo-job-outbox";
import { createGiftAssetsCleanupHandler } from "../apps/web/src/modules/media/application/gift-assets-cleanup";
import { mongoGiftPublicationRepository } from "../apps/web/src/modules/gifts/infrastructure/mongo-gift-publication-repository";
import {
  mongoDetachedAssetRepository,
  mongoMediaAssetRepository,
} from "../apps/web/src/modules/media/infrastructure/mongo-media-repository";

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
    templateVersion: "1.1.0",
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

const verificationUserId = "verification-user";
const assetId = randomUUID();
// The photo that replaces `assetId` in a later update, so the detached one can be cleaned up.
const replacementAssetId = randomUUID();
// A second, owned draft for the publish-versus-delete race.
const raceGiftId = randomUUID();
const racePublicId = `verify_${randomBytes(12).toString("base64url")}`;
const raceAssetId = randomUUID();
// A third, owned draft that isolates the publish revision compare-and-set.
const casGiftId = randomUUID();
const casPublicId = `verify_${randomBytes(12).toString("base64url")}`;
const casAssetId = randomUUID();

function readyAsset(id: string, owningGiftId: string): MediaAsset & { _id: string } {
  const now = new Date();
  return {
    _id: id,
    anonymousDraftId: null,
    attempts: 1,
    checksumSha256: "c".repeat(64),
    createdAt: now,
    declaredContentType: "image/jpeg",
    declaredSizeBytes: 3,
    derivatives: [
      {
        contentType: "image/webp",
        height: 960,
        key: `private/verification/${id}/w768.webp`,
        width: 768,
      },
    ],
    detachedAt: null,
    expiresAt: null,
    failureCode: null,
    fieldId: "memories",
    fieldSlot: null,
    giftId: owningGiftId,
    giftSlot: null,
    id,
    ownerId: verificationUserId,
    placeholderDataUrl: null,
    sourceKey: `private/verification/${id}/source`,
    status: "ready",
    updatedAt: now,
  };
}

/** A publish of `gift` referencing one asset, with a freshly generated share id and record id. */
function publishInputFor(gift: Gift, referencedAssetId: string, key: string): GiftPublishInput {
  const now = new Date();
  const published = publishGiftDraft(gift, {
    expectedRevision: gift.revision,
    grant: grantEntitlement(currentPlan("free"), "free", now),
    now,
    shareId: randomBytes(16).toString("base64url"),
  });
  assert(published.ok, "Domain publish failed.");
  return {
    assetRefs: [{ assetIds: [referencedAssetId], fieldId: "memories" }],
    expectedRevision: gift.revision,
    gift: published.data,
    idempotency: {
      actorKey: `user:${verificationUserId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      key,
      requestFingerprint: JSON.stringify(["publish", gift.publicId, gift.revision]),
      scope: "gift-publish",
    },
    ownerId: verificationUserId,
    precondition: { status: "draft" },
    publication: createGiftPublication({
      artifactContentHash: "f".repeat(64),
      assetIds: [referencedAssetId],
      audioTrackId: null,
      gift: published.data,
      id: randomUUID(),
    }),
  };
}

/**
 * An update of a published gift whose working copy is at `gift.revision`, conditional on the
 * current publication `publishedRevision` (what the publish checks saw) and on the gift not having
 * expired at `writeTime`.
 */
function republishInputFor(
  gift: Gift,
  referencedAssetId: string,
  key: string,
  publishedRevision: number,
  writeTime = new Date(),
): GiftPublishInput {
  const republished = republishGift(gift, { expectedRevision: gift.revision, now: new Date() });
  assert(republished.ok, "Domain republish failed.");
  return {
    assetRefs: [{ assetIds: [referencedAssetId], fieldId: "memories" }],
    expectedRevision: gift.revision,
    gift: republished.data,
    idempotency: {
      actorKey: `user:${verificationUserId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      key,
      requestFingerprint: JSON.stringify(["publish", gift.publicId, gift.revision]),
      scope: "gift-publish",
    },
    ownerId: verificationUserId,
    precondition: { now: writeTime, publishedRevision, status: "published" },
    publication: createGiftPublication({
      artifactContentHash: "f".repeat(64),
      assetIds: [referencedAssetId],
      audioTrackId: null,
      gift: republished.data,
      id: randomUUID(),
    }),
  };
}

type Plan = Readonly<{
  indexName?: string;
  inputStage?: Plan;
  inputStages?: Plan[];
  stage?: string;
}>;

function usesIndex(plan: Plan | undefined, indexName: string): boolean {
  if (!plan) return false;
  if (plan.stage === "IXSCAN" && plan.indexName === indexName) return true;
  return (
    usesIndex(plan.inputStage, indexName) ||
    (plan.inputStages ?? []).some((stage) => usesIndex(stage, indexName))
  );
}

/**
 * `explain` is not part of Stable API V1, which the application client enforces strictly, so the
 * query plan is read through a short-lived diagnostic client without it.
 */
async function explainLookup(
  collection: string,
  filter: Readonly<Record<string, unknown>>,
): Promise<Plan | undefined> {
  const environment = parseMongoEnvironment(process.env);
  const explainClient = await connectDiagnosticMongoClient(environment);
  try {
    const explanation = (await explainClient
      .db(environment.databaseName)
      .collection(collection)
      .find(filter)
      .explain("queryPlanner")) as { queryPlanner?: { winningPlan?: Plan } };
    return explanation.queryPlanner?.winningPlan;
  } finally {
    await explainClient.close();
  }
}

const database = await getDatabase();

try {
  await mongoGiftRepository.createDraft(draft, idempotency);

  const authorized = await mongoGiftRepository.findAuthorized(publicId, [anonymousAccessor]);
  assert(authorized?.id === giftId, "Anonymous authorization did not return the created draft.");

  const denied = await mongoGiftRepository.findAuthorized(publicId, [
    {
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

  // Publish the claimed draft with one referenced `ready` asset: two concurrent requests with the
  // same key (a double click), each with its own generated share id, yield one publication.
  await database
    .collection<MediaAsset & { _id: string }>(COLLECTIONS.assets)
    .insertOne(readyAsset(assetId, giftId));
  const publishKey = randomUUID();
  const firstInput = publishInputFor(claimed, assetId, publishKey);
  const secondInput = publishInputFor(claimed, assetId, publishKey);
  const concurrent = await Promise.all([
    mongoGiftRepository.publish(firstInput),
    mongoGiftRepository.publish(secondInput),
  ]);
  const shares = concurrent.map((result) =>
    result.status === "published" || result.status === "replayed"
      ? result.publication.shareId
      : null,
  );
  const [shareId, otherShareId] = shares;
  assert(
    typeof shareId === "string" && shareId === otherShareId,
    `Concurrent publishes with one key did not return one share id: ${concurrent
      .map((result) => result.status)
      .join(", ")}.`,
  );
  assert(
    concurrent.filter((result) => result.status === "published").length === 1,
    "Exactly one of two concurrent publishes with one key must write.",
  );
  const publishInput = concurrent[0]?.status === "published" ? firstInput : secondInput;
  const publishIdempotency = publishInput.idempotency;
  const publicationCount = await database
    .collection<{ giftId: string }>(COLLECTIONS.giftPublications)
    .countDocuments({ giftId });
  assert(publicationCount === 1, "Publishing did not store exactly one publication record.");
  const publishedGift = await mongoGiftRepository.findPublishedByShareId(shareId, new Date());
  assert(
    publishedGift?.id === giftId && publishedGift.status === "published",
    "The published gift was not found by its share id.",
  );
  const grantedEntitlement = publishedGift.entitlement;
  const grantedExpiry = publishedGift.expiresAt;
  assert(
    grantedEntitlement?.planId === "free" &&
      grantedEntitlement.source === "free" &&
      grantedExpiry?.getTime() === grantedEntitlement.grantedAt.getTime() + 14 * 86_400_000,
    "The first publish did not grant the free entitlement and its expiry.",
  );

  const publishReplay = await mongoGiftRepository.publish(publishInput);
  assert(
    publishReplay.status === "replayed" && publishReplay.publication.shareId === shareId,
    "Replaying the publish key did not return the same publication.",
  );

  const stalePublish = await mongoGiftRepository.publish({
    ...publishInput,
    expectedRevision: 0,
    idempotency: {
      ...publishIdempotency,
      key: randomUUID(),
      requestFingerprint: JSON.stringify(["publish", publicId, 0]),
    },
  });
  assert(stalePublish.status === "stale", "A publish at a stale revision was not rejected.");

  // The exact filter of `findPublishedByShareId`.
  const plan = await explainLookup(COLLECTIONS.gifts, {
    "access.mode": "unlisted",
    expiresAt: { $gt: new Date() },
    shareId: { $eq: shareId, $type: "string" },
    status: "published",
  });
  assert(
    usesIndex(plan, "gifts_share_id_unique"),
    "The share id lookup is not answered by an index scan of gifts_share_id_unique.",
  );

  // Edit after publish: the working copy moves on while the current publication stays.
  const ownerOfPublished = { kind: "user" as const, userId: verificationUserId };
  const firstRevision = publishInput.expectedRevision;
  const publishedWorkingCopy = await mongoGiftRepository.findAuthorized(publicId, [
    ownerOfPublished,
  ]);
  assert(
    publishedWorkingCopy?.status === "published" &&
      publishedWorkingCopy.publishedRevision === firstRevision,
    "The published gift does not point at its first publication.",
  );
  const edited = updateGiftDraft(publishedWorkingCopy, {
    content: { ...publishedWorkingCopy.content, data: { headline: "Edited after publishing" } },
    expectedRevision: firstRevision,
    now: new Date(),
  });
  assert(edited.ok, "Domain update of the published gift failed.");
  const savedWorkingCopy = await mongoGiftRepository.updateDraft(edited.data, firstRevision, [
    ownerOfPublished,
  ]);
  assert(
    savedWorkingCopy?.revision === firstRevision + 1 &&
      savedWorkingCopy.publishedRevision === firstRevision,
    "A save of the published gift did not keep its current publication.",
  );

  // Publish the working copy: a second publication with the same share id, and the pointer moves.
  const updateKey = randomUUID();
  const update = await mongoGiftRepository.publish(
    republishInputFor(savedWorkingCopy, assetId, updateKey, firstRevision),
  );
  assert(
    update.status === "published" &&
      update.publication.shareId === shareId &&
      update.publication.revision === firstRevision + 1,
    `Publishing the working copy did not store a second publication: ${update.status}.`,
  );
  const updatedGift = await mongoGiftRepository.findPublishedByShareId(shareId, new Date());
  assert(
    updatedGift?.publishedRevision === firstRevision + 1 && updatedGift.shareId === shareId,
    "The update did not move the pointer under the same share id.",
  );
  assert(
    JSON.stringify(updatedGift.entitlement) === JSON.stringify(grantedEntitlement) &&
      updatedGift.expiresAt?.getTime() === grantedExpiry.getTime(),
    "The update changed the entitlement or the expiry.",
  );
  const cleanupJobs = await database
    .collection<{ deduplicationKey: string; payload: { giftId: string } }>(COLLECTIONS.jobOutbox)
    .find({ "payload.giftId": giftId, type: "gift.assets.cleanup.v1" })
    .toArray();
  assert(
    cleanupJobs.length === 1 &&
      cleanupJobs[0]?.deduplicationKey === `gift.assets.cleanup.v1:${giftId}:${firstRevision + 1}`,
    `The update did not commit exactly one cleanup job, or the first publish committed one: ${cleanupJobs.length}.`,
  );
  const publications = await database
    .collection<{ giftId: string; revision: number; shareId: string }>(COLLECTIONS.giftPublications)
    .find({ giftId })
    .sort({ revision: 1 })
    .toArray();
  assert(
    publications.length === 2 &&
      publications.every((record) => record.shareId === shareId) &&
      publications[0]?.revision === firstRevision,
    "The first publication was not kept next to the second one.",
  );
  const currentPublicationPlan = await explainLookup(COLLECTIONS.giftPublications, {
    giftId: { $eq: giftId },
    revision: { $eq: firstRevision + 1 },
  });
  assert(
    usesIndex(currentPublicationPlan, "gift_publications_gift_revision_unique"),
    "The current publication lookup is not answered by gift_publications_gift_revision_unique.",
  );

  const replayAfterUpdate = await mongoGiftRepository.publish(publishInput);
  assert(
    replayAfterUpdate.status === "replayed" &&
      replayAfterUpdate.publication.revision === firstRevision,
    "Replaying the first publish key did not return the first publication.",
  );

  const duplicateRevision = await mongoGiftRepository.publish(
    republishInputFor(savedWorkingCopy, assetId, randomUUID(), firstRevision),
  );
  const publicationsAfterDuplicate = await database
    .collection<{ giftId: string }>(COLLECTIONS.giftPublications)
    .countDocuments({ giftId });
  assert(
    (duplicateRevision.status === "stale" || duplicateRevision.status === "revision-taken") &&
      publicationsAfterDuplicate === 2,
    `Publishing the same revision again under another key was not refused: ${duplicateRevision.status}.`,
  );

  // Expiry: past `expiresAt` the share link is gone, and an update write conditioned on that time
  // is refused by its `expiresAt` clause (with a live time it would reach the publication insert).
  const afterExpiry = new Date(grantedExpiry.getTime() + 1);
  const expiredLookup = await mongoGiftRepository.findPublishedByShareId(shareId, afterExpiry);
  assert(expiredLookup === null, "An expired share link was still found.");
  const expiredUpdate = await mongoGiftRepository.publish(
    republishInputFor(savedWorkingCopy, assetId, randomUUID(), firstRevision + 1, afterExpiry),
  );
  assert(
    expiredUpdate.status === "stale",
    `An update after expiry was not refused by the write: ${expiredUpdate.status}.`,
  );

  // A photo of the current publication is detached from the working copy, never deleted.
  const deletion = await mongoMediaAssetRepository.markDeleting(assetId, giftId, new Date());
  assert(
    deletion.kind === "detached",
    `A photo of the current publication was not detached: ${deletion.kind}.`,
  );
  const assetAfter = await mongoMediaAssetRepository.findById(assetId);
  assert(
    assetAfter?.status === "ready" &&
      assetAfter.detachedAt !== null &&
      assetAfter.giftSlot === null,
    "The detached photo left ready or kept its quota slots.",
  );

  // An update without the detached photo: its cleanup job deletes the photo for good.
  await database
    .collection<MediaAsset & { _id: string }>(COLLECTIONS.assets)
    .insertOne(readyAsset(replacementAssetId, giftId));
  const beforeReplacement = await mongoGiftRepository.findAuthorized(publicId, [ownerOfPublished]);
  assert(beforeReplacement?.status === "published", "The published gift was not readable.");
  const replacementSave = updateGiftDraft(beforeReplacement, {
    content: { ...beforeReplacement.content, data: { headline: "Photo replaced" } },
    expectedRevision: beforeReplacement.revision,
    now: new Date(),
  });
  assert(replacementSave.ok, "Domain update before the replacement failed.");
  const replacementCopy = await mongoGiftRepository.updateDraft(
    replacementSave.data,
    beforeReplacement.revision,
    [ownerOfPublished],
  );
  assert(replacementCopy, "The working copy before the replacement was not saved.");
  const replacement = await mongoGiftRepository.publish(
    republishInputFor(
      replacementCopy,
      replacementAssetId,
      randomUUID(),
      beforeReplacement.publishedRevision ?? 0,
    ),
  );
  assert(
    replacement.status === "published",
    `The replacement update failed: ${replacement.status}.`,
  );
  const detachedPlan = await explainLookup(COLLECTIONS.assets, {
    detachedAt: { $ne: null },
    giftId,
    status: "ready",
  });
  assert(
    usesIndex(detachedPlan, "assets_gift_field_created"),
    "The detached-asset lookup is not answered by assets_gift_field_created.",
  );
  const deletedKeys: string[] = [];
  const cleanupRunner = createJobRunner({
    handlers: [
      createGiftAssetsCleanupHandler({
        assets: mongoDetachedAssetRepository,
        gifts: mongoGiftRepository,
        publications: mongoGiftPublicationRepository,
        storage: {
          deleteObject: (key) => {
            deletedKeys.push(key);
            return Promise.resolve();
          },
        },
      }),
    ],
    repository: mongoJobOutbox,
  });
  const cleanupResults = await cleanupRunner.runAvailable(10);
  const cleanedAsset = await database
    .collection<{ _id: string; status: string }>(COLLECTIONS.assets)
    .findOne({ _id: assetId });
  const keptAsset = await database
    .collection<{ _id: string; status: string }>(COLLECTIONS.assets)
    .findOne({ _id: replacementAssetId });
  // Only this gift's jobs: the database may hold other generic jobs of its own.
  const ownCleanupJobs = await database
    .collection<{ status: string }>(COLLECTIONS.jobOutbox)
    .find({ "payload.giftId": giftId, type: "gift.assets.cleanup.v1" })
    .toArray();
  assert(
    cleanupResults.length >= 1 &&
      ownCleanupJobs.length === 2 &&
      ownCleanupJobs.every((job) => job.status === "completed") &&
      cleanedAsset?.status === "deleted" &&
      keptAsset?.status === "ready" &&
      deletedKeys.includes(`private/verification/${assetId}/w768.webp`),
    `The cleanup jobs did not delete exactly the detached photo: ${ownCleanupJobs
      .map((job) => job.status)
      .join(", ")}.`,
  );

  // A publish and a deletion of its only photo race on a fresh draft: exactly one of them wins.
  const raceDraft = createGiftDraft({
    anonymousDraftId: null,
    claimTokenHash: null,
    content: { data: {}, schemaVersion: 1, templateId: "memory-box", templateVersion: "1.1.0" },
    id: raceGiftId,
    now: new Date(),
    ownerId: verificationUserId,
    publicId: racePublicId,
  });
  await mongoGiftRepository.createDraft(raceDraft, {
    accessor: { kind: "user", userId: verificationUserId },
    actorKey: `user:${verificationUserId}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    key: randomUUID(),
    requestFingerprint: JSON.stringify(["memory-box", "1.1.0"]),
    scope: "gift-create",
  });
  await database
    .collection<MediaAsset & { _id: string }>(COLLECTIONS.assets)
    .insertOne(readyAsset(raceAssetId, raceGiftId));
  const [racePublish, raceDeletion] = await Promise.all([
    mongoGiftRepository.publish(publishInputFor(raceDraft, raceAssetId, randomUUID())),
    mongoMediaAssetRepository.markDeleting(raceAssetId, raceGiftId, new Date()),
  ]);
  const raceGift = await database
    .collection<{ _id: string; status: string }>(COLLECTIONS.gifts)
    .findOne({ _id: raceGiftId });
  const raceAsset = await mongoMediaAssetRepository.findById(raceAssetId);
  // When the publish commits first, the retried deletion sees the new publication and detaches.
  const publishWon =
    racePublish.status === "published" &&
    raceDeletion.kind === "detached" &&
    raceGift?.status === "published" &&
    raceAsset?.status === "ready";
  const deletionWon =
    racePublish.status === "assets-changed" &&
    raceDeletion.kind === "deleting" &&
    raceGift?.status === "draft" &&
    raceAsset?.status === "deleting";
  assert(
    publishWon !== deletionWon,
    `A publish and a deletion interleaved: publish ${racePublish.status}, deletion ${raceDeletion.kind}, gift ${raceGift?.status}, asset ${raceAsset?.status}.`,
  );
  process.stdout.write(
    `Publish/delete race: ${publishWon ? "the publish" : "the deletion"} won, the other refused.\n`,
  );

  // The revision compare-and-set alone: a fresh draft that is still a `draft` and whose referenced
  // asset is `ready`, saved to revision 1, then published against revision 0. Only the revision
  // differs, so `stale` proves the revision filter (the earlier stale check ran on a published
  // gift, where the draft precondition alone already refuses).
  const casDraft = createGiftDraft({
    anonymousDraftId: null,
    claimTokenHash: null,
    content: { data: {}, schemaVersion: 1, templateId: "memory-box", templateVersion: "1.1.0" },
    id: casGiftId,
    now: new Date(),
    ownerId: verificationUserId,
    publicId: casPublicId,
  });
  await mongoGiftRepository.createDraft(casDraft, {
    accessor: { kind: "user", userId: verificationUserId },
    actorKey: `user:${verificationUserId}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    key: randomUUID(),
    requestFingerprint: JSON.stringify(["memory-box", "1.1.0"]),
    scope: "gift-create",
  });
  await database
    .collection<MediaAsset & { _id: string }>(COLLECTIONS.assets)
    .insertOne(readyAsset(casAssetId, casGiftId));
  const ownerAccessor = { kind: "user" as const, userId: verificationUserId };
  const casSaved = updateGiftDraft(casDraft, {
    content: { ...casDraft.content, data: { headline: "Saved after the publish began" } },
    expectedRevision: 0,
    now: new Date(),
  });
  assert(casSaved.ok, "Domain update of the compare-and-set draft failed.");
  const casPersisted = await mongoGiftRepository.updateDraft(casSaved.data, 0, [ownerAccessor]);
  assert(casPersisted?.revision === 1, "The compare-and-set draft did not reach revision 1.");
  const casKey = randomUUID();
  const casPublish = await mongoGiftRepository.publish(
    publishInputFor(casDraft, casAssetId, casKey),
  );
  assert(
    casPublish.status === "stale",
    `A publish at revision 0 of a draft at revision 1 was not stale: ${casPublish.status}.`,
  );
  const casPublications = await database
    .collection<{ giftId: string }>(COLLECTIONS.giftPublications)
    .countDocuments({ giftId: casGiftId });
  const casKeys = await database
    .collection<{ key: string }>(COLLECTIONS.idempotencyKeys)
    .countDocuments({ key: casKey });
  const casGift = await database
    .collection<{ _id: string; revision: number; status: string }>(COLLECTIONS.gifts)
    .findOne({ _id: casGiftId });
  assert(
    casPublications === 0 && casKeys === 0 && casGift?.status === "draft" && casGift.revision === 1,
    "A stale publish wrote a publication, an idempotency key or the gift.",
  );

  process.stdout.write("Gift persistence verification completed successfully.\n");
} finally {
  const giftIds = [giftId, raceGiftId, casGiftId];
  await Promise.all([
    database.collection<{ _id: string }>(COLLECTIONS.gifts).deleteMany({ _id: { $in: giftIds } }),
    ...[
      COLLECTIONS.giftRevisions,
      COLLECTIONS.idempotencyKeys,
      COLLECTIONS.giftPublications,
      COLLECTIONS.assets,
    ].map((name) =>
      database.collection<{ giftId: string }>(name).deleteMany({ giftId: { $in: giftIds } }),
    ),
    database
      .collection<{ payload: { giftId: string } }>(COLLECTIONS.jobOutbox)
      .deleteMany({ "payload.giftId": { $in: giftIds } }),
  ]);
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
