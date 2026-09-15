import { NextResponse } from "next/server";

import { WEB_APP_VERSION } from "@/config/application";
import { getHealthStatus } from "@/modules/health/application/get-health-status";

export function GET() {
  return NextResponse.json(
    { data: getHealthStatus({ version: WEB_APP_VERSION }) },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
