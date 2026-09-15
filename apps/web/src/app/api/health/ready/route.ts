import { API_ERROR_CODES } from "@love-memory/contracts";
import { pingDatabase } from "@love-memory/database";
import { NextResponse } from "next/server";

import { WEB_APP_VERSION } from "@/config/application";
import { getHealthStatus } from "@/modules/health/application/get-health-status";
import { reportReadinessFailure } from "@/observability/operational-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    await pingDatabase();

    return NextResponse.json(
      { data: getHealthStatus({ version: WEB_APP_VERSION }) },
      { headers: { "Cache-Control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    reportReadinessFailure(error, requestId);

    return NextResponse.json(
      {
        error: {
          code: API_ERROR_CODES.internal,
          message: "Service dependencies are not ready.",
          requestId,
        },
      },
      {
        headers: { "Cache-Control": "no-store", "x-request-id": requestId },
        status: 503,
      },
    );
  }
}
