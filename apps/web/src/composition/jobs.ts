import { createStorage } from "@/composition/media";
import { type AnyJobHandler, type JobType } from "@/modules/jobs/application/job-registry";
import { assertJobOutboxFlowing } from "@/modules/jobs/application/job-outbox-health";
import { createJobRunner, type JobRunner } from "@/modules/jobs/application/job-runner";
import {
  createJobDispatcher,
  type JobDispatcher,
  triggerJobsDrain,
} from "@/modules/jobs/infrastructure/job-dispatcher";
import { mongoJobOutbox } from "@/modules/jobs/infrastructure/mongo-job-outbox";
import { mongoGiftPublicationRepository } from "@/modules/gifts/infrastructure/mongo-gift-publication-repository";
import { mongoGiftRepository } from "@/modules/gifts/infrastructure/mongo-gift-repository";
import {
  createGiftAssetsCleanupHandler,
  GIFT_ASSETS_CLEANUP_JOB,
} from "@/modules/media/application/gift-assets-cleanup";
import { assertMediaRuntimeReady } from "@/modules/media/infrastructure/media-job-scheduler";
import { mongoDetachedAssetRepository } from "@/modules/media/infrastructure/mongo-media-repository";
import { reportJobFailure, reportOperationalFailure } from "@/observability/operational-errors";

let jobRunner: JobRunner | undefined;

/** The registered generic types; `createHandlers` builds exactly these (`jobs.test.ts`). */
export const REGISTERED_JOB_TYPES: readonly JobType[] = [GIFT_ASSETS_CLEANUP_JOB];

/** Every registered generic job type (`background-jobs`); `media.process.v1` is not one of them. */
export function createHandlers(): AnyJobHandler[] {
  return [
    createGiftAssetsCleanupHandler({
      assets: mongoDetachedAssetRepository,
      gifts: mongoGiftRepository,
      publications: mongoGiftPublicationRepository,
      storage: createStorage(),
    }),
  ];
}

// Built on first use: a storage configuration error is thrown to the caller and never cached.
export function getJobRunner(): JobRunner {
  jobRunner ??= createJobRunner({
    handlers: createHandlers(),
    logFailure: reportJobFailure,
    repository: mongoJobOutbox,
  });
  return jobRunner;
}

/**
 * Wakes a worker after a commit that enqueued jobs, in the worker mode of `media-processing`
 * (`MEDIA_WORKER_MODE`). It never throws: the outbox and `jobs-sweep` keep the work safe.
 */
export const jobDispatcher: JobDispatcher = createJobDispatcher({
  mode: () => assertMediaRuntimeReady(process.env),
  reportFailure: (error) => reportOperationalFailure("jobs.dispatch", error, "background"),
  runInline: (limit) => getJobRunner().runAvailable(limit),
  trigger: (type) => triggerJobsDrain(type),
});

/** Readiness: throws `JobOutboxStalledError` when a due generic job has waited over 10 minutes. */
export function checkJobOutbox(): Promise<void> {
  // The static list: readiness never builds handlers or storage clients.
  return assertJobOutboxFlowing({ monitor: mongoJobOutbox, types: REGISTERED_JOB_TYPES });
}
