import { type HealthStatus, HealthStatusSchema } from "@love-memory/contracts";
import { APP_CONFIG } from "@love-memory/shared";

export type Clock = () => Date;
export type HealthStatusDependencies = Readonly<{
  clock?: Clock;
  version: string;
}>;

export function getHealthStatus({
  clock = () => new Date(),
  version,
}: HealthStatusDependencies): HealthStatus {
  return HealthStatusSchema.parse({
    service: APP_CONFIG.slug,
    status: "ok",
    timestamp: clock().toISOString(),
    version,
  });
}
