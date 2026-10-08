import { API_ERROR_CODES } from "@love-memory/contracts";
import { pingDatabase } from "@love-memory/database";
import { getStorageConfiguration } from "@love-memory/storage";
import { NextResponse } from "next/server";

import { checkJobOutbox } from "@/composition/jobs";
import { checkMediaOutbox } from "@/composition/media";
import { WEB_APP_VERSION } from "@/config/application";
import { getHealthStatus } from "@/modules/health/application/get-health-status";
import { assertMediaRuntimeReady } from "@/modules/media/infrastructure/media-job-scheduler";
import { reportReadinessFailure } from "@/observability/operational-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const storage = getStorageConfiguration();
    assertMediaRuntimeReady(process.env, storage.driver);
    await pingDatabase();
    // A stalled media worker leaves uploads "processing" forever without any other signal.
    await checkMediaOutbox();
    // Likewise for the generic jobs: a stalled `jobs-drain`/`jobs-sweep` leaves cleanup undone.
    await checkJobOutbox();

    return NextResponse.json(
      { data: getHealthStatus({ version: WEB_APP_VERSION }) },
      { headers: { "Cache-Control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    reportReadinessFailure(error, requestId);

    return NextResponse.json(
      {
        error: {
          code: API_ERROR_CODES.unavailable,
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
