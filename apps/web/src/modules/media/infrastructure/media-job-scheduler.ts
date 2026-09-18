import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

export type MediaJobSource = "retry" | "upload-complete";
export type MediaWorkerMode = "inline" | "trigger";

export function mediaWorkerMode(
  environment: Readonly<Record<string, string | undefined>>,
): MediaWorkerMode {
  const configured = environment["MEDIA_WORKER_MODE"];
  if (configured === "inline" || configured === "trigger") return configured;
  if (configured) throw new Error("MEDIA_WORKER_MODE must be either inline or trigger.");
  return environment["NODE_ENV"] === "production" ? "trigger" : "inline";
}

export function assertMediaRuntimeReady(
  environment: Readonly<Record<string, string | undefined>>,
): MediaWorkerMode {
  const mode = mediaWorkerMode(environment);
  if (mode === "trigger" && !environment["TRIGGER_SECRET_KEY"]) {
    throw new Error("TRIGGER_SECRET_KEY is required when MEDIA_WORKER_MODE=trigger.");
  }
  return mode;
}

export async function scheduleMediaProcessing(source: MediaJobSource): Promise<void> {
  if (assertMediaRuntimeReady(process.env) === "inline") {
    const { getMediaWorker } = await import("@/composition/media");
    await getMediaWorker().runAvailable();
    return;
  }
  const dispatchWindow = Math.floor(Date.now() / 10_000);
  const idempotencyKey = await idempotencyKeys.create(
    `media-worker-drain:${source}:${dispatchWindow}`,
    { scope: "global" },
  );
  await tasks.trigger(
    "media-worker-drain",
    { source },
    { idempotencyKey, idempotencyKeyTTL: "1m" },
  );
}
