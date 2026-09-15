import "server-only";

import { timingSafeEqual } from "node:crypto";

import { type TechnicalSpikeEnvironment } from "@/config/technical-spikes";

export type TechnicalSpikeAccess = "authorized" | "disabled" | "unauthorized";

function extractBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length);
}

export function authorizeTechnicalSpike(
  request: Request,
  environment: TechnicalSpikeEnvironment,
): TechnicalSpikeAccess {
  if (!environment.enabled || !environment.token) {
    return "disabled";
  }

  const receivedToken = extractBearerToken(request);

  if (!receivedToken) {
    return "unauthorized";
  }

  const expected = Buffer.from(environment.token);
  const received = Buffer.from(receivedToken);

  return expected.byteLength === received.byteLength && timingSafeEqual(expected, received)
    ? "authorized"
    : "unauthorized";
}
