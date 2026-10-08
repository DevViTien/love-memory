import { getJobRunner } from "@/composition/jobs";
import { mongoJobOutbox } from "@/modules/jobs/infrastructure/mongo-job-outbox";
import { getMongoClient } from "../packages/database/src/index";

// Operator commands for generic background jobs (`background-jobs`): ids, types, counts and error
// codes only, never payload values or gift content.
const maximumSteps = 100;
const deadListLimit = 100;

function writeEvent(event: Readonly<Record<string, number | string | null | undefined>>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function work(): Promise<void> {
  const runner = getJobRunner();
  let handled = 0;
  while (handled < maximumSteps) {
    const result = await runner.runStep();
    if (result.outcome === "idle") break;
    handled += 1;
    writeEvent({ event: "job_step", jobId: result.id, outcome: result.outcome, type: result.type });
  }
  writeEvent({ event: "jobs_drained", handled });
}

async function listDead(): Promise<void> {
  for (const job of await mongoJobOutbox.listDead(deadListLimit)) {
    process.stdout.write(
      `${[job.id, job.type, job.attempts, job.lastErrorCode ?? "-", job.updatedAt.toISOString()].join("\t")}\n`,
    );
  }
}

async function retry(jobId: string | undefined): Promise<void> {
  if (!jobId) throw new Error("Expected a job id: pnpm jobs:retry <jobId>");
  const outcome = await mongoJobOutbox.revive(jobId, new Date());
  if (outcome === "not-found") throw new Error(`Job not found: ${jobId}`);
  if (outcome === "not-dead") throw new Error(`Job is not dead: ${jobId}`);
  writeEvent({ event: "job_revived", jobId });
}

try {
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case "work":
      await work();
      break;
    case "dead":
      await listDead();
      break;
    case "retry":
      await retry(argument);
      break;
    default:
      throw new Error("Expected jobs command: work, dead, or retry <jobId>.");
  }
} finally {
  const client = await getMongoClient().catch(() => undefined);
  await client?.close();
}
