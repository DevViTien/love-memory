import { runMongoReadWriteProbe } from "@love-memory/database";

import { getTechnicalSpikeEnvironment } from "@/config/technical-spikes";
import { handleMongoSpike } from "@/modules/health/presentation/mongo-spike-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleMongoSpike(request, {
    environment: getTechnicalSpikeEnvironment(),
    runProbe: runMongoReadWriteProbe,
  });
}
