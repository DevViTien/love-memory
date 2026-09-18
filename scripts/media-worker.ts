import { getMediaWorker } from "@/composition/media";
import { getMongoClient } from "../packages/database/src/index";

const maximumJobs = 100;
const worker = getMediaWorker();
let handled = 0;

function writeEvent(event: Readonly<Record<string, number | string | undefined>>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

try {
  while (handled < maximumJobs) {
    const result = await worker.runNext();
    if (result.status === "idle") break;
    handled += 1;
    writeEvent({ assetId: result.assetId, event: "media_job_finished", status: result.status });
  }

  writeEvent({ event: "media_worker_drained", handled });
} finally {
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
