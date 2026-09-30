import { randomUUID } from "node:crypto";

import { COLLECTIONS, getDatabase, getMongoClient } from "../packages/database/src/index";
import { type MediaAsset } from "../packages/domain/src/index";
import {
  mongoMediaAssetRepository,
  mongoMediaWorkerRepository,
} from "../apps/web/src/modules/media/infrastructure/mongo-media-repository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// The worker claims the oldest due job and the oldest expired asset in the whole database. Running
// the verification on a clock in the year 2000 keeps it from touching real jobs or assets when it is
// pointed at a shared development database; neither collection has a TTL index.
const epoch = new Date("2000-01-01T00:00:00.000Z");
const at = (minutes: number) => new Date(epoch.getTime() + minutes * 60_000);

const giftId = randomUUID();
const fieldLimit = 5;
const giftLimit = 30;
const createdAssetIds: string[] = [];

function newAsset(): MediaAsset {
  const id = randomUUID();
  createdAssetIds.push(id);
  return {
    anonymousDraftId: null,
    attempts: 0,
    checksumSha256: null,
    createdAt: epoch,
    declaredContentType: "image/jpeg",
    declaredSizeBytes: 3,
    derivatives: [],
    expiresAt: at(10),
    failureCode: null,
    fieldId: "photos",
    fieldSlot: null,
    giftId,
    giftSlot: null,
    id,
    ownerId: "media-verification-user",
    placeholderDataUrl: null,
    sourceKey: `private/verification/${id}`,
    status: "initiated",
    updatedAt: epoch,
  };
}

type AssetDocument = Readonly<{
  _id: string;
  fieldSlot: number | null;
  giftId: string;
  giftSlot: number | null;
  status: string;
}>;
type JobDocument = Readonly<{
  _id: string;
  attempts: number;
  availableAt: Date;
  payload: Readonly<{ assetId: string }>;
  status: string;
}>;

const database = await getDatabase();
const assets = database.collection<AssetDocument>(COLLECTIONS.assets);
const jobs = database.collection<JobDocument>(COLLECTIONS.jobOutbox);

try {
  // Quota slots under concurrency.
  const candidates = Array.from({ length: fieldLimit + 3 }, newAsset);
  const reserved = await Promise.all(
    candidates.map((asset) =>
      mongoMediaAssetRepository.createWithinQuota(asset, giftLimit, fieldLimit),
    ),
  );
  assert(
    reserved.filter(Boolean).length === fieldLimit,
    `Concurrent reservations granted ${reserved.filter(Boolean).length} slots; expected ${fieldLimit}.`,
  );
  const stored = await assets.find({ giftId }).toArray();
  assert(stored.length === fieldLimit, "Stored asset count does not match the field limit.");
  assert(
    new Set(stored.map((asset) => asset.fieldSlot)).size === fieldLimit &&
      new Set(stored.map((asset) => asset.giftSlot)).size === fieldLimit,
    "Two assets share a gift or field slot.",
  );
  const overflow = await mongoMediaAssetRepository.createWithinQuota(
    newAsset(),
    giftLimit,
    fieldLimit,
  );
  assert(!overflow, "A reservation beyond the field limit was accepted.");

  const storedIds = stored.map((asset) => asset._id);
  const [completedId, retriedId, expiredId] = storedIds;
  assert(completedId && retriedId && expiredId, "Not enough reserved assets to continue.");

  // Completion outbox and a successful processing commit.
  const uploaded = await mongoMediaAssetRepository.markUploadedAndEnqueue(completedId, at(-60));
  assert(uploaded?.status === "uploaded", "Upload completion did not move the asset to uploaded.");
  const completionJobs = await jobs.find({ "payload.assetId": completedId }).toArray();
  assert(
    completionJobs.length === 1 && completionJobs[0]?.status === "pending",
    "Upload completion did not enqueue exactly one pending job.",
  );
  const firstClaim = await mongoMediaWorkerRepository.claimNext(at(-60));
  assert(
    firstClaim && "jobId" in firstClaim && firstClaim.asset.id === completedId,
    "The worker did not claim the completed upload.",
  );
  assert(firstClaim.asset.status === "processing", "The claimed asset is not processing.");
  await mongoMediaWorkerRepository.complete(
    completedId,
    firstClaim.jobId,
    {
      checksumSha256: "a".repeat(64),
      derivatives: [
        {
          contentType: "image/webp",
          height: 240,
          key: `private/verification/${completedId}/w320.webp`,
          width: 320,
        },
      ],
      placeholderDataUrl: null,
    },
    at(-60),
  );
  const ready = await mongoMediaAssetRepository.findById(completedId);
  assert(ready?.status === "ready", "Completing processing did not mark the asset ready.");

  // Transient failure, retry scheduling, requeue and an exhausted stale lease.
  await mongoMediaAssetRepository.markUploadedAndEnqueue(retriedId, at(0));
  let claim = await mongoMediaWorkerRepository.claimNext(at(0));
  assert(claim && "jobId" in claim, "The worker did not claim the retried asset.");
  await mongoMediaWorkerRepository.fail(retriedId, claim.jobId, "PROCESSING_FAILED", at(1), at(0));
  const scheduled = await jobs.findOne({ _id: claim.jobId });
  assert(
    scheduled?.status === "pending" && scheduled.availableAt.getTime() === at(1).getTime(),
    "A transient failure did not schedule a retry.",
  );
  const requeued = await mongoMediaAssetRepository.requeue(retriedId, at(0.5));
  assert(requeued?.status === "uploaded", "Requeue did not move the failed asset to uploaded.");
  const available = await jobs.findOne({ _id: claim.jobId });
  assert(
    available?.status === "pending" && available.availableAt.getTime() === at(0.5).getTime(),
    "Requeue did not make the pending job available immediately.",
  );
  claim = await mongoMediaWorkerRepository.claimNext(at(0.5));
  assert(claim && "jobId" in claim, "The requeued job was not claimed.");
  await mongoMediaWorkerRepository.fail(retriedId, claim.jobId, "PROCESSING_FAILED", at(2), at(1));
  claim = await mongoMediaWorkerRepository.claimNext(at(2));
  assert(claim && "jobId" in claim, "The third attempt was not claimed.");
  const exhausted = await mongoMediaWorkerRepository.claimNext(at(20));
  assert(
    exhausted &&
      "exhaustedAsset" in exhausted &&
      exhausted.exhaustedAsset.id === retriedId &&
      exhausted.exhaustedAsset.status === "failed" &&
      exhausted.exhaustedAsset.failureCode === "PROCESSING_FAILED",
    "A stale lease with an exhausted budget did not fail the asset terminally.",
  );

  // Abandoned upload cleanup.
  const expired = await mongoMediaWorkerRepository.claimExpiredUpload(at(30));
  assert(
    expired?.giftId === giftId && expired.status === "deleting",
    "An expired initiated asset was not claimed for cleanup.",
  );
  await mongoMediaWorkerRepository.finishExpiredCleanup(expired.id, at(30));
  const cleaned = await assets.findOne({ _id: expired.id });
  assert(cleaned?.status === "deleted", "Expired upload cleanup did not mark the asset deleted.");

  process.stdout.write("Media persistence verification completed successfully.\n");
} finally {
  await Promise.all([
    assets.deleteMany({ giftId }),
    jobs.deleteMany({ "payload.assetId": { $in: createdAssetIds } }),
  ]);
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
