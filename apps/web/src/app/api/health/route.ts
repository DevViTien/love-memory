import { WEB_APP_VERSION } from "@/config/application";
import { createApiSuccessResponse } from "@/http/api-response";
import { getHealthStatus } from "@/modules/health/application/get-health-status";

export function GET() {
  return createApiSuccessResponse(
    getHealthStatus({ version: WEB_APP_VERSION }),
    crypto.randomUUID(),
  );
}
