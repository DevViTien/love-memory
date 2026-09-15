import { API_ERROR_CODES } from "@love-memory/contracts";

import { type TechnicalSpikeEnvironment } from "@/config/technical-spikes";
import { createApiErrorResponse, createApiSuccessResponse } from "@/http/api-response";
import { getTechnicalSpikeAccessFailure } from "@/http/technical-spike-response";
import { reportOperationalFailure } from "@/observability/operational-errors";

export type MongoSpikeResult = Readonly<{
  connectionReused: boolean;
  readVerified: boolean;
  writeVerified: boolean;
}>;

export type MongoSpikeRouteDependencies = Readonly<{
  environment: TechnicalSpikeEnvironment;
  reportFailure?: typeof reportOperationalFailure;
  runProbe: () => Promise<MongoSpikeResult>;
}>;

export async function handleMongoSpike(
  request: Request,
  { environment, reportFailure = reportOperationalFailure, runProbe }: MongoSpikeRouteDependencies,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const authorizationFailure = getTechnicalSpikeAccessFailure(request, environment, requestId);

  if (authorizationFailure) {
    return authorizationFailure;
  }

  try {
    const result = await runProbe();

    if (!result.connectionReused || !result.readVerified || !result.writeVerified) {
      throw new Error("MongoDB probe did not verify every invariant.");
    }

    return createApiSuccessResponse(result, requestId);
  } catch (error) {
    reportFailure("mongodb.read-write-probe", error, requestId);
    return createApiErrorResponse({
      code: API_ERROR_CODES.unavailable,
      message: "Database read/write verification failed.",
      requestId,
      status: 503,
    });
  }
}
