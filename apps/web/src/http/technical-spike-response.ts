import { API_ERROR_CODES } from "@love-memory/contracts";

import { type TechnicalSpikeEnvironment } from "@/config/technical-spikes";
import { authorizeTechnicalSpike } from "@/security/technical-spike-access";

import { createApiErrorResponse } from "./api-response";

export function getTechnicalSpikeAccessFailure(
  request: Request,
  environment: TechnicalSpikeEnvironment,
  requestId: string,
): Response | undefined {
  const access = authorizeTechnicalSpike(request, environment);

  if (access === "disabled") {
    return createApiErrorResponse({
      code: API_ERROR_CODES.notFound,
      message: "Technical spike endpoint is disabled.",
      requestId,
      status: 404,
    });
  }

  if (access === "unauthorized") {
    return createApiErrorResponse({
      code: API_ERROR_CODES.unauthorized,
      message: "Technical spike authorization is required.",
      requestId,
      status: 401,
    });
  }

  return undefined;
}
